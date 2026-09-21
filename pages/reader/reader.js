// pages/reader/reader.js —— 小说式阅读器（以书/章为单位）
// 交互：双击选词 · 长按选整句 · 跨词拖选 · 单击呼出「顶栏 + 底部控制条」（目录/夜间/设置/翻译）
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
const INDENT_ON = 34; // 首行缩进两个字母

// 从生效后的主题变量里反推当前阅读排版
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
    book: { id: '', title: '' },
    article: { id: '', title: '' },   // article 即当前章节
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
    // 阅读设置抽屉（底部控制条「设置」呼出）
    rs: { show: false },
    rsThemes: [],
    rsTheme: 'default',
    rsFonts: [],
    rsFont: 'system',
    rsUiSame: false,
    rsEff: { size: 34, line: 2.1, indent: true },
    sizeOptions: SIZE_OPTIONS,
    lineOptions: LINE_OPTIONS,
    // 小说式框架：自定义顶栏 + 底部控制条 + 目录抽屉（默认沉浸全屏，单击正文唤出）
    statusBarH: 24,
    ctl: { show: false },
    toc: { show: false, list: [], current: '' },
    chIndex: 0,
    chTotal: 0,
    progressPct: 0,
    showTrans: false,
    transMap: {},       // pid -> 句译
    favored: false
  },

  onLoad(options) {
    this.bookId = options.bookId;
    this.chapterId = options.chapterId;
    this.touchStartId = null;
    this.longPressed = false;
    this.lastTap = { id: null, time: 0 };
    this.tapTimer = null;
    this.dayThemeId = 'default'; // 夜间切换前记住白天主题
    try {
      const win = wx.getWindowInfo();
      this.setData({ statusBarH: win.statusBarHeight || 24 });
    } catch (e) {}
    theme.bindPage(this, -1);
    const cur = theme.currentId();
    if (cur !== 'night') this.dayThemeId = cur;
    const book = store.getBook(this.bookId);
    if (!book) {
      wx.showToast({ title: '书籍不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.book = book;
    this.setData({ book: { id: book.id, title: book.title }, showTrans: !!store.getSettings().showTrans });
    this.loadChapter(this.chapterId);
  },

  onShow() {
    theme.bindPage(this, -1);
    // 从书籍详情/编辑页回来时章节列表可能变化
    if (this.bookId && this.chapterId && store.getChapter(this.bookId, this.chapterId)) {
      const b = store.getBook(this.bookId);
      if (b) {
        this.book = b;
        this.setData({ 'toc.list': this.buildTocList(b) });
      }
    }
  },

  buildTocList(book) {
    return (book.chapters || []).map((c, i) => ({ id: c.id, title: c.title || '第' + (i + 1) + '章', idx: i + 1 }));
  },

  // ---------- 章节装载 ----------
  loadChapter(chapterId) {
    const ch = store.getChapter(this.bookId, chapterId);
    if (!ch) {
      wx.showToast({ title: '章节不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.chapterId = chapterId;
    this.article = { id: ch.id, title: ch.title };
    this.marks = store.getMarks(chapterId);
    this.notes = store.getNotes(chapterId);
    this.paraTexts = (ch.tokens.paragraphs || []).map((p) => normText(joinTokens(p.tokens)));
    this.paraRawTexts = (ch.tokens.paragraphs || []).map((p) => joinTokens(p.tokens));
    // pid -> 句译（一句一段：取段内第一个 token 的 sid）
    const transMap = {};
    (ch.tokens.paragraphs || []).forEach((p) => {
      const sid = p.tokens && p.tokens[0] && p.tokens[0].sid;
      const tr = (ch.translations || [])[sid];
      if (tr) transMap[p.pid] = tr;
    });
    const chs = (this.book.chapters || []);
    const idx = chs.findIndex((c) => c.id === chapterId);
    const chIndex = idx >= 0 ? idx : 0;
    const pct = chs.length ? Math.round(((chIndex + 1) / chs.length) * 100) : 0;
    store.touchBook(this.bookId, chapterId);
    this.setData({
      article: { id: ch.id, title: ch.title },
      paragraphs: decorateSpacing(ch.tokens.paragraphs || []),
      marksMap: this.buildMarksMap(),
      spaceMarks: this.buildSpaceMarks(),
      noteCounts: this.buildNoteCounts(),
      transMap,
      chIndex,
      chTotal: chs.length,
      progressPct: pct,
      favored: store.isFavored(this.bookId, chapterId),
      'toc.list': this.buildTocList(this.book),
      'toc.current': chapterId,
      selStart: -1,
      selEnd: -1,
      selectedText: '',
      'bar.show': false
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },

  // ---------- 顶栏 / 底部控制条 ----------
  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/shelf/shelf' }) });
  },

  toggleCtl() {
    this.setData({ 'ctl.show': !this.data.ctl.show });
  },

  openToc() {
    this.setData({ ctl: { show: false }, 'toc.show': true });
  },
  closeToc() {
    this.setData({ 'toc.show': false });
  },
  pickChapter(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ 'toc.show': false });
    if (id && id !== this.chapterId) this.loadChapter(id);
  },

  onSlider(e) {
    const i = Number(e.detail.value);
    const ch = (this.book.chapters || [])[i];
    if (ch) this.loadChapter(ch.id);
  },

  prevChapter() {
    const i = this.data.chIndex;
    if (i <= 0) return wx.showToast({ title: '已经是第一章', icon: 'none' });
    this.loadChapter(this.book.chapters[i - 1].id);
  },

  nextChapter() {
    const i = this.data.chIndex;
    if (i >= this.data.chTotal - 1) return wx.showToast({ title: '已经是最后一章', icon: 'none' });
    this.loadChapter(this.book.chapters[i + 1].id);
  },

  // 夜间：与白天主题一键互换
  toggleNight() {
    const target = theme.currentId() === 'night' ? this.dayThemeId || 'default' : 'night';
    if (target !== 'night') this.dayThemeId = target;
    theme.use(target);
    theme.bindPage(this, -1);
    this.setData({ rsTheme: target });
    if (this.data.rs.show) this.refreshRSFonts();
  },

  toggleTrans() {
    const v = !this.data.showTrans;
    const s = store.getSettings();
    s.showTrans = v;
    store.setSettings(s);
    this.setData({ showTrans: v });
    wx.showToast({ title: v ? '已显示句译' : '已隐藏句译', icon: 'none' });
  },

  toggleFavor() {
    const on = store.toggleFavor({
      bookId: this.bookId,
      chapterId: this.chapterId,
      title: this.data.article.title,
      bookTitle: this.book.title
    });
    this.setData({ favored: on });
    wx.showToast({ title: on ? '已收藏本章' : '已取消收藏', icon: 'none' });
  },

  // ---------- 选择 ----------
  onTouchStart(e) {
    if (this.data.ctl.show) {
      // 正文上的点击优先用于收起控制条
      this.setData({ 'ctl.show': false });
      this.clearSelection();
      return;
    }
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
      this.longPressed = false;
      this.cancelTap();
      return;
    }
    if (a == null || endId == null) return;
    if (a !== endId) {
      this.cancelTap();
      return this.selectRange(Math.min(a, endId), Math.max(a, endId));
    }
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
      this.cancelTap();
      return this.selectRange(id, id);
    }
    this.lastTap = { id, time: now };
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => {
      this.tapTimer = null;
      this.lastTap = { id: null, time: 0 };
      // 单击：开/关小说式控制条（顶栏 + 底部控制）
      this.toggleCtl();
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

  positionBar(start, end) {
    const q = wx.createSelectorQuery().in(this);
    q.select('#tok-' + start).boundingClientRect();
    q.select('#tok-' + end).boundingClientRect();
    q.exec((res) => {
      const first = res[0], last = res[1];
      if (!first || !last) return;
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const barW = 350, barH = 46; // 7 个操作项
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
    if (act === 'fav') {
      this.hideBar();
      store.addSentence({
        text,
        translation: this.sentenceTransOf(text),
        bookId: this.bookId,
        chapterId: this.chapterId,
        bookTitle: this.book.title,
        chapterTitle: this.data.article.title
      });
      wx.showToast({ title: '已收藏到句集', icon: 'success' });
      return;
    }
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
    this.hideBar();
    this.runAI(singleWord ? 'word' : 'sentence');
  },

  // 收藏句子时尽量带上已缓存的句译
  sentenceTransOf(text) {
    const key = normText(text);
    let best = '';
    this.paraTexts.forEach((pt, pid) => {
      if (pt === key || pt.indexOf(key) !== -1 || key.indexOf(pt) !== -1) {
        const tr = this.data.transMap[pid];
        if (tr && !best) best = tr;
      }
    });
    return best;
  },

  addMark() {
    const { selStart: start, selEnd: end } = this.data;
    if (start < 0) return;
    const hit = this.marks.find((m) => m.start <= start && m.end >= end);
    if (hit) {
      this.marks = store.removeMark(this.chapterId, hit);
      this.refreshMarks();
      this.clearSelection();
      wx.showToast({ title: '已取消划线', icon: 'none' });
      return;
    }
    this.marks = store.addMark(this.chapterId, {
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
    const qa = { qaLoading: false, qaResult: this.data.panel.qaResult || '' };
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
      dict.lookup(text)
        .then(finish)
        .catch(() => llm.ask({ type, text }).then((r) => finish(r.result)).catch(fail));
    } else {
      // 句子优先用已缓存的句译（免费零延迟），缓存缺失才走 AI 语法解析
      const cached = this.sentenceTransOf(text);
      llm.ask({ type, text })
        .then((r) => {
          if (cached && r.result) r.result.cachedTranslation = cached;
          finish(r.result);
        })
        .catch(fail);
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
      fromBook: this.book.title,
      fromChapter: this.data.article.title,
      bookId: this.bookId,
      chapterId: this.chapterId,
      createdAt: Date.now()
    });
    wx.showToast({ title: '已加入生词本', icon: 'success' });
  },
  onSaveNote(e) {
    const note = (e.detail.note || '').trim();
    if (!note) return wx.showToast({ title: '笔记内容为空', icon: 'none' });
    this.notes = store.addNote(this.chapterId, {
      note, sel: this.data.selectedText, createdAt: Date.now()
    });
    wx.showToast({ title: '笔记已保存', icon: 'success' });
    this.refreshNotes();
    this.setData({ 'panel.show': false });
    this.clearSelection();
  },

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

  // ---------- 段落笔记角标 ----------
  refreshNotes() {
    this.notes = store.getNotes(this.chapterId);
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
        this.notes = store.removeNote(this.chapterId, item);
        const list = this.data.noteView.list.filter((x) => x.createdAt !== item.createdAt);
        this.setData({ 'noteView.list': list, noteCounts: this.buildNoteCounts() });
        if (!list.length) this.setData({ 'noteView.show': false });
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  },

  // ---------- 阅读设置抽屉 ----------
  openRS() {
    this.clearSelection();
    const t = theme.current();
    this.setData({
      'rs.show': true,
      'ctl.show': false,
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
    font.preloadAll();
  },

  applyRS() {
    theme.bindPage(this, -1);
    this.refreshRSFonts();
  },

  pickTheme(e) {
    const id = e.currentTarget.dataset.id;
    if (id === this.data.rsTheme) return;
    const t = theme.use(id);
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
    if (this.data.rsUiSame) s.fontUi = id;
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
        if (s.fontUi && s.fontUi !== 'system') s.fontUi = rec.id;
        store.setSettings(s);
        this.applyRS();
        wx.showToast({ title: '已安装「' + rec.name + '」', icon: 'none' });
      })
      .catch((err) => {
        wx.hideLoading();
        if (err && err.errMsg && err.errMsg.indexOf('cancel') !== -1) return;
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
