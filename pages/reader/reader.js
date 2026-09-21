// pages/reader/reader.js —— 划词阅读器（核心页）
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const font = require('../../utils/font');
const { joinTokens, decorateSpacing } = require('../../utils/tokenize');
const llm = require('../../utils/llm');
const tts = require('../../utils/tts');
const dict = require('../../utils/dict');

const PUNCT = /^[,.!?;:%…'")\]”’]+$/;

const SIZE_OPTIONS = [
  { v: 30, t: '小' },
  { v: 34, t: '中' },
  { v: 38, t: '大' },
  { v: 42, t: '特大' }
];
const LINE_OPTIONS = [
  { v: 1.8, t: '紧凑' },
  { v: 2.1, t: '标准' },
  { v: 2.4, t: '宽松' }
];
const INDENT_ON = 34; // 首行缩进两个字母（正文字号 34rpx 时约两个字母宽）

// 从生效后的主题变量里反推当前阅读排版（用户没调过时就是主题默认值）
const readEff = (t) => ({
  size: parseInt(t.vars['read-font'], 10) || 34,
  line: parseFloat(t.vars['read-line']) || 2.1,
  indent: (parseInt(t.vars['read-indent'], 10) || 0) > 0
});

const normText = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const fmtTime = (ts) => {
  const d = new Date(ts);
  const p = (x) => (x < 10 ? '0' + x : '' + x);
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
};

Page({
  data: {
    article: { id: '', title: '' },
    paragraphs: [],
    marksMap: {},
    spaceMarks: {},
    noteCounts: {},
    noteView: { show: false, pid: -1, list: [], paraText: '' },
    selStart: -1,
    selEnd: -1,
    selectedText: '',
    bar: { show: false, left: 0, top: 0 },
    panel: { show: false, loading: false, type: 'word', tab: 'trans', result: null, playing: false, detailLoading: false, detailResult: null, qaLoading: false, qaResult: '', qaSuggestions: [] },
    // 阅读设置抽屉（单击呼出）：主题 / 字体 / 排版
    rs: { show: false },
    rsThemes: [],
    rsTheme: 'default',
    rsFonts: [],
    rsFont: 'system',
    rsUiSame: false,
    rsEff: { size: 34, line: 2.1, indent: true },
    sizeOptions: SIZE_OPTIONS,
    lineOptions: LINE_OPTIONS
  },

  onLoad(options) {
    this.articleId = options.id;
    this.touchStartId = null;
    this.longPressed = false;                 // 长按后 touchend 不覆盖整句选区
    this.lastTap = { id: null, time: 0 };     // 双击判定：上一次点按的词与时间
    this.tapTimer = null;                     // 单击延迟定时器（等可能的第二次点按）
    theme.bindPage(this, -1);                 // 主题变量注入 + 导航栏配色
    const art = store.getArticle(this.articleId);
    if (!art) {
      wx.showToast({ title: '文章不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.article = art;
    this.marks = store.getMarks(this.articleId);
    wx.setNavigationBarTitle({ title: art.title });
    // decorateSpacing：为每个词标注其后是否有空格，空格由渲染层独立承担（不参与选中/高亮）
    this.paraTexts = art.paragraphs.map((p) => normText(joinTokens(p.tokens)));
    this.paraRawTexts = art.paragraphs.map((p) => joinTokens(p.tokens)); // 弹层里展示原文用（保留大小写）
    this.notes = store.getNotes(this.articleId);
    this.setData({
      article: { id: art.id, title: art.title },
      paragraphs: decorateSpacing(art.paragraphs),
      marksMap: this.buildMarksMap(),
      spaceMarks: this.buildSpaceMarks(),
      noteCounts: this.buildNoteCounts()
    });
  },

  onShow() {
    theme.bindPage(this, -1); // 从后台/设置页回来时重刷主题与导航栏
  },

  buildMarksMap() {
    const m = {};
    this.marks.forEach((r) => {
      for (let i = r.start; i <= r.end; i++) m[i] = true;
    });
    return m;
  },

  // 词间空格是否需要跟随划线着色：仅当空格两侧的词都在同一划线区间内
  buildSpaceMarks() {
    const m = {};
    this.marks.forEach((r) => {
      for (let i = r.start; i < r.end; i++) m[i] = true;
    });
    return m;
  },

  refreshMarks() {
    this.setData({ marksMap: this.buildMarksMap(), spaceMarks: this.buildSpaceMarks() });
  },

  // ---------- 段落笔记角标 ----------
  // 笔记存的是「选中文本」，按文本匹配归到所属段落（一句一段后即句子级评论）
  refreshNotes() {
    this.notes = store.getNotes(this.articleId);
    this.setData({ noteCounts: this.buildNoteCounts() });
  },

  buildNoteCounts() {
    const counts = {};
    (this.notes || []).forEach((n) => {
      const pid = this.findNotePara(n.sel);
      if (pid >= 0) counts[pid] = (counts[pid] || 0) + 1;
    });
    return counts;
  },

  findNotePara(sel) {
    const s = normText(sel);
    if (!s) return -1;
    let hit = this.paraTexts.findIndex((t) => t.indexOf(s) !== -1);
    if (hit < 0) {
      // 跨段选区等匹配不到整段时，退化为用开头一段文本找
      const head = s.slice(0, Math.max(12, Math.ceil(s.length / 3)));
      hit = this.paraTexts.findIndex((t) => t.indexOf(head) !== -1);
    }
    return hit;
  },

  onNoteBadge(e) {
    const pid = e.currentTarget.dataset.pid;
    const list = (this.notes || [])
      .map((n) => ({ n, p: this.findNotePara(n.sel) }))
      .filter((x) => x.p === pid)
      .map((x) => ({ sel: x.n.sel, note: x.n.note, createdAt: x.n.createdAt, timeText: fmtTime(x.n.createdAt) }));
    this.clearSelection();
    this.setData({
      noteView: { show: true, pid, list, paraText: (this.paraRawTexts || [])[pid] || '' }
    });
  },

  noop() {},

  closeNoteView() {
    this.setData({ 'noteView.show': false });
  },

  delParaNote(e) {
    const item = this.data.noteView.list[e.currentTarget.dataset.idx];
    if (!item) return;
    wx.showModal({
      title: '删除笔记',
      content: '确定删除这条笔记吗？',
      confirmText: '删除',
      confirmColor: '#E24B4A',
      success: (res) => {
        if (!res.confirm) return;
        this.notes = store.removeNote(this.articleId, item);
        const list = this.data.noteView.list.filter((x) => x.createdAt !== item.createdAt);
        this.setData({ 'noteView.list': list, noteCounts: this.buildNoteCounts() });
        if (!list.length) this.setData({ 'noteView.show': false });
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  },

  // ---------- 选择 ----------
  onTouchStart(e) {
    if (this.data.bar.show || this.data.panel.show) {
      this.clearSelection();
      return;
    }
    this.touchStartId = e.currentTarget.dataset.id;
    this.longPressed = false;
  },

  onTouchEnd(e) {
    const endId = e.currentTarget.dataset.id;
    const a = this.touchStartId;
    this.touchStartId = null;
    if (this.longPressed) {
      // 长按已选中整句，松开时保持不变
      this.longPressed = false;
      this.cancelTap();
      return;
    }
    if (a == null || endId == null) return;
    // 起止词不同 = 跨词拖选
    if (a !== endId) {
      this.cancelTap();
      return this.selectRange(Math.min(a, endId), Math.max(a, endId));
    }
    // 同词：双击选中该单词；单击（等待期内无第二击）呼出阅读设置
    this.handleTap(a);
  },

  cancelTap() {
    if (this.tapTimer) { clearTimeout(this.tapTimer); this.tapTimer = null; }
    this.lastTap = { id: null, time: 0 };
  },

  handleTap(id) {
    if (!this.lastTap) this.lastTap = { id: null, time: 0 };
    const now = Date.now();
    if (this.lastTap.id === id && now - this.lastTap.time < 300) {
      // 双击：选中单词
      this.cancelTap();
      return this.selectRange(id, id);
    }
    this.lastTap = { id, time: now };
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => {
      this.tapTimer = null;
      this.lastTap = { id: null, time: 0 };
      // 单击：开/关阅读设置抽屉（小说软件式）
      if (this.data.rs.show) this.closeRS();
      else this.openRS();
    }, 280);
  },

  onLongPress(e) {
    this.cancelTap();
    this.longPressed = true;
    const id = e.currentTarget.dataset.id;
    const loc = this.findToken(id);
    if (!loc) return;
    let start = -1, end = -1;
    this.data.paragraphs[loc.pIndex].tokens.forEach((t) => {
      if (t.sid === loc.token.sid) {
        if (start < 0) start = t.id;
        end = t.id;
      }
    });
    if (start >= 0) this.selectRange(start, end);
  },

  findToken(id) {
    const paras = this.data.paragraphs;
    for (let p = 0; p < paras.length; p++) {
      const arr = paras[p].tokens;
      if (arr.length && id <= arr[arr.length - 1].id) {
        return { pIndex: p, token: arr.find((x) => x.id === id) };
      }
    }
    return null;
  },

  selectRange(start, end) {
    const tokens = [];
    this.data.paragraphs.forEach((para) =>
      para.tokens.forEach((t) => { if (t.id >= start && t.id <= end) tokens.push(t); })
    );
    const text = joinTokens(tokens);
    this.setData({ selStart: start, selEnd: end, selectedText: text });
    this.positionBar(start, end);
  },

  clearSelection() {
    this.touchStartId = null;
    this.setData({ selStart: -1, selEnd: -1, selectedText: '', 'bar.show': false });
  },

  hideBar() {
    this.setData({ 'bar.show': false });
  },

  // 操作栏定位到选区下方（放不下则移到上方）
  positionBar(start, end) {
    const q = wx.createSelectorQuery().in(this);
    q.select('#tok-' + start).boundingClientRect();
    q.select('#tok-' + end).boundingClientRect();
    q.exec((res) => {
      const first = res[0], last = res[1];
      if (!first || !last) return;
      const win = wx.getSystemInfoSync();
      const barW = 300, barH = 46; // 6 个操作项
      let left = (first.left + last.right) / 2 - barW / 2;
      left = Math.max(8, Math.min(left, win.windowWidth - barW - 8));
      let top = last.bottom + 8;
      if (top + barH > win.windowHeight - 40) top = Math.max(70, first.top - barH - 8);
      this.setData({ bar: { show: true, left, top } });
    });
  },

  // ---------- 操作栏动作 ----------
  onBarAction(e) {
    const act = e.detail.act;
    if (act === 'close') return this.clearSelection();

    const text = this.data.selectedText;
    const singleWord = !/\s/.test(text.trim());

    if (act === 'copy') {
      wx.setClipboardData({ data: text });
      this.clearSelection();
      return;
    }
    if (act === 'mark') return this.addMark();
    if (act === 'play') {
      this.hideBar();
      const play = dict.isWord(text)
        ? tts.playUrl(dict.audioUrl(text)).catch(() => tts.play(text))
        : tts.play(text);
      play.catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
      return;
    }
    if (act === 'note') {
      this.hideBar();
      this.setData({ 'panel.show': true, 'panel.tab': 'note', 'panel.type': singleWord ? 'word' : 'sentence' });
      return;
    }
    if (act === 'ask') {
      this.hideBar();
      this.setData({
        'panel.show': true,
        'panel.tab': 'ask',
        'panel.type': singleWord ? 'word' : 'sentence',
        'panel.qaLoading': false,
        'panel.qaResult': '',
        'panel.qaSuggestions': []
      });
      this.loadSuggestions();
      return;
    }
    // translate：单词走词典、句子走 AI（语法解析在面板的「语法解析」Tab 查看）
    this.hideBar();
    this.runAI(singleWord ? 'word' : 'sentence');
  },

  addMark() {
    const { selStart: start, selEnd: end } = this.data;
    if (start < 0) return;
    // 选区已被现有划线完全覆盖 → 取消该划线（可切换）
    const hit = this.marks.find((m) => m.start <= start && m.end >= end);
    if (hit) {
      this.marks = store.removeMark(this.articleId, hit);
      this.refreshMarks();
      this.clearSelection();
      wx.showToast({ title: '已取消划线', icon: 'none' });
      return;
    }
    this.marks = store.addMark(this.articleId, {
      start, end, text: this.data.selectedText, createdAt: Date.now()
    });
    this.refreshMarks();
    this.clearSelection();
    wx.showToast({ title: '已划线', icon: 'success' });
  },

  // ---------- AI / 词典 ----------
  runAI(type) {
    const text = this.data.selectedText;
    if (!text) return;
    const qa = { qaLoading: false, qaResult: this.data.panel.qaResult || '' }; // 保留本选区的提问记录
    this.setData({
      panel: Object.assign({ show: true, loading: true, type, tab: 'trans', result: null, playing: false, detailLoading: false, detailResult: null }, qa)
    });
    const finish = (result) => {
      this.setData({ 'panel.loading': false, 'panel.result': result });
      if (store.getSettings().autoPlay) this.doPlay();
    };
    const fail = (err) => {
      this.setData({ 'panel.loading': false });
      wx.showModal({ title: '请求失败', content: err.message || '请稍后重试', showCancel: false });
    };

    if (type === 'word') {
      // 单词优先走词典 API（快、免 AI 费用），失败降级 AI
      // 注意：llm.ask 返回 {result} 包装对象，需取 .result；dict.lookup 直接返回结果对象
      dict.lookup(text)
        .then(finish)
        .catch(() => llm.ask({ type, text }).then((r) => finish(r.result)).catch(fail));
    } else {
      llm.ask({ type, text }).then((r) => finish(r.result)).catch(fail);
    }
  },

  // ---------- AI 面板事件 ----------
  onPanelTab(e) {
    this.setData({ 'panel.tab': e.detail.tab });
  },
  onPanelClose() {
    this.setData({ 'panel.show': false, 'panel.playing': false });
    tts.stop();
    this.clearSelection();
  },
  onPanelPlay() { this.doPlay(); },
  onPanelStop() {
    tts.stop();
    this.setData({ 'panel.playing': false });
  },
  onPanelRetry() {
    if (this.data.panel.loading) return;
    this.runAI(this.data.panel.type);
  },
  // 详细语法拆解：从单词、短语到语法逐层（结果独立缓存）
  onPanelDetail() {
    if (this.data.panel.detailLoading) return;
    const text = this.data.selectedText;
    if (!text) return;
    this.setData({ 'panel.detailLoading': true, 'panel.tab': 'detail' });
    llm.ask({ type: 'sentenceDetail', text })
      .then((r) => this.setData({ 'panel.detailLoading': false, 'panel.detailResult': r.result }))
      .catch((err) => {
        this.setData({ 'panel.detailLoading': false, 'panel.tab': 'grammar' });
        wx.showModal({ title: '详细解析失败', content: err.message || '请稍后重试', showCancel: false });
      });
  },
  onAddVocab() {
    const r = this.data.panel.result;
    if (!r) return;
    store.addVocab({
      word: this.data.selectedText.trim(),
      phonetic: r.phonetic || '',
      pos: r.pos || '',
      translation: r.translation || '',
      fromArticle: this.article.title,
      createdAt: Date.now()
    });
    wx.showToast({ title: '已加入生词本', icon: 'success' });
  },
  onSaveNote(e) {
    const note = (e.detail.note || '').trim();
    if (!note) return wx.showToast({ title: '笔记内容为空', icon: 'none' });
    this.notes = store.addNote(this.articleId, {
      note, sel: this.data.selectedText, createdAt: Date.now()
    });
    wx.showToast({ title: '笔记已保存', icon: 'success' });
    this.refreshNotes();
    this.setData({ 'panel.show': false });
    this.clearSelection();
  },

  // 推荐问题：针对选中文本生成 3 个常见问题（静默失败，不影响手动提问）
  loadSuggestions() {
    const text = this.data.selectedText;
    if (!text) return;
    llm.ask({ type: 'suggestQ', text })
      .then((r) => {
        const qs = (r.result && r.result.questions) || [];
        this.setData({ 'panel.qaSuggestions': qs.slice(0, 3) });
      })
      .catch(() => {});
  },

  // 划词提问：针对选中文本的自由问答（纯文本回答，独立缓存）
  onPanelAsk(e) {
    if (this.data.panel.qaLoading) return;
    const question = (e.detail.question || '').trim();
    const text = this.data.selectedText;
    if (!question || !text) return;
    this.setData({ 'panel.qaLoading': true });
    llm.ask({ type: 'textAsk', text, question })
      .then((r) => this.setData({ 'panel.qaLoading': false, 'panel.qaResult': r.result }))
      .catch((err) => {
        this.setData({ 'panel.qaLoading': false });
        wx.showModal({ title: '提问失败', content: err.message || '请稍后重试', showCancel: false });
      });
  },

  // 详细拆解卡片小喇叭：单词用词典真人发音，短语/例句走 TTS
  onPanelSpeak(e) {
    const text = (e.detail.text || '').trim();
    if (!text) return;
    const play = dict.isWord(text)
      ? dict.audioUrl(text)
        ? tts.playUrl(dict.audioUrl(text)).catch(() => tts.play(text))
        : tts.play(text)
      : tts.play(text);
    play.catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  doPlay() {
    const text = this.data.selectedText;
    // 单词用词典真人发音，失败降级 TTS 合成
    const play = dict.isWord(text)
      ? tts.playUrl(dict.audioUrl(text)).catch(() => tts.play(text))
      : tts.play(text);
    play
      .then(() => this.setData({ 'panel.playing': false }))
      .catch((err) => {
        this.setData({ 'panel.playing': false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
    this.setData({ 'panel.playing': true });
  },

  // ---------- 阅读设置抽屉（主题 / 字体 / 排版，从「我的」页迁入） ----------
  openRS() {
    this.clearSelection();
    const t = theme.current();
    this.setData({
      'rs.show': true,
      rsThemes: theme.list().map((x) => ({ id: x.id, name: x.name, desc: x.desc, cover: x.cover })),
      rsTheme: t.id
    });
    this.refreshRSFonts(t);
  },

  closeRS() {
    this.setData({ 'rs.show': false });
  },

  refreshRSFonts(t) {
    const th = t || theme.current();
    this.setData({
      rsFonts: font.list().map((x) => ({
        id: x.id,
        name: x.name,
        kind: x.kind,
        css: font.cssFamily(x.id),
        metaText: x.kind === 'system' ? '系统' : (x.kind === 'builtin' ? '内置' : '') + (x.sizeText || '')
      })),
      rsFont: th.fontReadId,
      rsUiSame: th.fontUiId === th.fontReadId && th.fontReadId !== 'system',
      rsEff: readEff(th)
    });
    // 让每个字体卡片用自己的字体渲染预览（未加载过的会在这里真正加载）
    font.preloadAll();
  },

  // 重新注入样式 + 刷新字体列表（切换字体 / 导入 / 删除后统一走这里）
  applyRS() {
    theme.bindPage(this, -1);
    this.refreshRSFonts();
  },

  pickTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.rsTheme) return;
    const t = theme.use(id);
    // 主题会带来推荐的字体与排版，所以这里要连字体一起刷新
    theme.bindPage(this, -1);
    this.setData({ rsTheme: t.id });
    this.refreshRSFonts();
    wx.showToast({ title: '已切换「' + t.name + '」', icon: 'none' });
  },

  pickFont(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.rsFont) return;
    const s = store.getSettings();
    s.fontRead = id;
    if (this.data.rsUiSame) s.fontUi = id; // 「同时用到界面文字」开着时一起换
    store.setSettings(s);
    this.applyRS();
    const def = font.find(id);
    wx.showToast({ title: '已切换「' + (def ? def.name : id) + '」', icon: 'none' });
  },

  importFont() {
    wx.showLoading({ title: '正在导入…', mask: true });
    font.pickAndInstall()
      .then((rec) => {
        wx.hideLoading();
        const s = store.getSettings();
        s.fontRead = rec.id;
        if (s.fontUi && s.fontUi !== 'system') s.fontUi = rec.id; // 界面字体也是自备字体时跟着换
        store.setSettings(s);
        this.applyRS();
        wx.showToast({ title: '已安装「' + rec.name + '」', icon: 'none' });
      })
      .catch((err) => {
        wx.hideLoading();
        if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) return; // 用户取消选择
        wx.showModal({
          title: '导入失败',
          content: (err && err.message) || '字体文件无法使用，请换一个 ttf / otf 文件试试。',
          showCancel: false
        });
      });
  },

  removeFont(e) {
    const { id, name } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除字体包',
      content: '删除「' + name + '」？字体文件会从本机移除，正在使用它的地方会回到系统字体。',
      confirmColor: '#E24B4A',
      success: (res) => {
        if (!res.confirm) return;
        font.uninstall(id);
        this.applyRS();
        wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  setSize(e) {
    const s = store.getSettings();
    s.readFontSize = Number(e.currentTarget.dataset.v);
    store.setSettings(s);
    this.applyRS();
  },
  setLine(e) {
    const s = store.getSettings();
    s.readLineHeight = Number(e.currentTarget.dataset.v);
    store.setSettings(s);
    this.applyRS();
  },
  onIndent(e) {
    const s = store.getSettings();
    s.readIndent = e.detail.value ? INDENT_ON : 0;
    store.setSettings(s);
    this.applyRS();
  },
  onUiSame(e) {
    const s = store.getSettings();
    s.fontUi = e.detail.value ? this.data.rsFont : 'system';
    store.setSettings(s);
    this.applyRS();
    wx.showToast({ title: e.detail.value ? '界面文字已同阅读字体' : '界面文字已回到系统字体', icon: 'none' });
  },

  onUnload() {
    if (this.tapTimer) clearTimeout(this.tapTimer);
    tts.stop();
  }
});
