// pages/reader/reader.js —— 小说式阅读器（连续滚动：本章读完自动接下一章）
// 交互：双击选词 · 长按选整句 · 跨词拖选 · 单击立即呼出/收起「顶栏 + 底部控制条」
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
    article: { id: '', title: '' },   // 当前视口所在章节
    blocks: [],          // 连续滚动流：[{type:'title'|'para', uid, cid, ...}]
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
    // 小说式框架：自定义顶栏 + 底部控制条 + 目录抽屉（默认沉浸全屏）
    statusBarH: 24,
    ctl: { show: false },
    toc: { show: false, list: [], current: '' },
    chIndex: 0,
    chTotal: 0,
    progressPct: 0,
    showTrans: false,
    transMap: {},       // uid -> 句译
    favored: false,
    loadingMore: false,
    hasMore: true
  },

  onLoad(options) {
    this.bookId = options.bookId;
    this.chapterId = options.chapterId;
    this.touchStartId = null;
    this.longPressed = false;
    this.lastTap = { id: null, time: 0 };
    this.pendingToggle = false;
    this.tapTimer = null;
    this.dayThemeId = 'default';
    this.scrollTop = 0;
    this.lastScrollTop = 0;
    this.anchors = [];      // [{cid, idx, top}] 章节标题在文档中的位置
    this.blocks = [];
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
    this.startAt(this.chapterId);
  },

  onShow() {
    theme.bindPage(this, -1);
    if (this.bookId && store.getBook(this.bookId)) {
      const b = store.getBook(this.bookId);
      this.book = b;
      const list = this.buildTocList(b);
      const cur = (b.chapters || []).findIndex((c) => c.id === this.chapterId);
      this.setData({
        'toc.list': list,
        'toc.current': this.chapterId,
        chTotal: (b.chapters || []).length,
        chIndex: cur >= 0 ? cur : this.data.chIndex
      });
    }
  },

  buildTocList(book) {
    return (book.chapters || []).map((c, i) => ({ id: c.id, title: c.title || '第' + (i + 1) + '章', idx: i + 1 }));
  },

  // ---------- 连续滚动：章节流式装载 ----------
  // 重置并从指定章节开始（目录跳转 / 上一章 / 下一章 / 进度滑条）
  startAt(chapterId) {
    const ch = store.getChapter(this.bookId, chapterId);
    if (!ch) {
      wx.showToast({ title: '章节不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.chapters = [];      // [{cid, idx, offset, marks, notes, paras:[{uid,pid,text,raw}]}]
    this.paraByUid = {};     // uid -> {uid, cid, pid, text, raw}
    this.nextId = 0;
    this.nextUid = 0;
    this.anchors = [];
    this.scrollTop = 0;
    this.lastScrollTop = 0;
    this.blocks = [];
    this.setData({
      blocks: [],
      marksMap: {},
      spaceMarks: {},
      noteCounts: {},
      transMap: {},
      selStart: -1,
      selEnd: -1,
      selectedText: '',
      'bar.show': false,
      hasMore: true
    });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    this.appendChapter(chapterId, true);
    this.ensureFilled();
  },

  // 追加一章到滚动流末尾；token id 按章节偏移重排，保证全局唯一
  appendChapter(chapterId, isFirst) {
    const ch = store.getChapter(this.bookId, chapterId);
    if (!ch || !ch.tokens) return false;
    const chs = (this.book.chapters || []);
    const idx = chs.findIndex((c) => c.id === chapterId);
    if (idx < 0) return false;
    if (this.chapters.some((x) => x.cid === chapterId)) return false; // 已装载

    const offset = this.nextId;
    const rec = {
      cid: chapterId,
      idx,
      offset,
      marks: store.getMarks(chapterId),
      notes: store.getNotes(chapterId),
      paras: []
    };

    const newBlocks = [];
    newBlocks.push({ uid: this.nextUid++, type: 'title', cid: chapterId, idx, text: ch.title || ('第' + (idx + 1) + '章') });

    const paras = decorateSpacing(ch.tokens.paragraphs || []);
    let maxId = -1;
    paras.forEach((p) => {
      const uid = this.nextUid++;
      const tokens = (p.tokens || []).map((t) => {
        if (t.id > maxId) maxId = t.id;
        return { id: t.id + offset, w: t.w, sid: t.sid, sp: t.sp };
      });
      const raw = joinTokens(p.tokens || []);
      rec.paras.push({ uid, pid: p.pid, text: normText(raw), raw });
      this.paraByUid[uid] = { uid, cid: chapterId, pid: p.pid, text: normText(raw), raw };
      newBlocks.push({ uid, type: 'para', cid: chapterId, idx, pid: p.pid, tokens });
    });

    const span = Math.max(maxId + 1, ch.tokens.tokenCount || 0);
    this.nextId = offset + span;
    this.chapters.push(rec);
    this.blocks = this.blocks.concat(newBlocks);

    const patch = {
      blocks: this.blocks,
      transMap: this.buildTransMap(),
      marksMap: this.buildMarksMap(),
      spaceMarks: this.buildSpaceMarks(),
      noteCounts: this.buildNoteCounts(),
      chTotal: chs.length,
      hasMore: idx < chs.length - 1
    };
    if (isFirst) {
      patch.article = { id: ch.id, title: ch.title };
      patch.chIndex = idx;
      patch.progressPct = chs.length ? Math.round(((idx + 1) / chs.length) * 100) : 0;
      patch.favored = store.isFavored(this.bookId, chapterId);
      patch['toc.list'] = this.buildTocList(this.book);
      patch['toc.current'] = chapterId;
    }
    this.setData(patch);
    this.chapterId = chapterId;
    store.touchBook(this.bookId, chapterId);
    this.measureAnchors();
    return true;
  },

  // 滚到底部：续下一章
  appendNext() {
    if (!this.book || !this.data.hasMore) return;
    const chs = (this.book.chapters || []);
    if (!chs.length) return;
    const lastIdx = this.chapters.length ? this.chapters[this.chapters.length - 1].idx : -1;
    const next = chs[lastIdx + 1];
    if (!next) {
      this.setData({ hasMore: false });
      return;
    }
    this.appendChapter(next.id);
  },

  onReachBottom() {
    this.appendNext();
    this.ensureFilled();
  },

  // 短章节场景：整篇不足两屏时自动补章，避免"翻不动又没有下一章"
  ensureFilled() {
    if (!this.data.hasMore || !wx.createSelectorQuery) return;
    const q = wx.createSelectorQuery().in(this);
    q.selectViewport().scrollOffset();
    q.exec((res) => {
      if (!res || !res[0]) return;
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      if (res[0].scrollHeight < win.windowHeight * 2) {
        const before = this.chapters.length;
        this.appendNext();
        if (this.chapters.length > before) setTimeout(() => this.ensureFilled(), 60);
      }
    });
  },

  // 章节标题锚点测距：用于滚动时判断"当前在第几章"
  measureAnchors() {
    const q = wx.createSelectorQuery().in(this);
    q.selectAll('.ch-anchor').boundingClientRect();
    q.exec((res) => {
      const rects = (res && res[0]) || [];
      if (!rects.length) return;
      this.anchors = rects.map((r, i) => ({
        cid: (this.chapters[i] || {}).cid,
        idx: (this.chapters[i] || {}).idx,
        top: (r.top || 0) + this.scrollTop
      }));
      this.updateCurrentChapter(this.scrollTop);
    });
  },

  updateCurrentChapter(scrollTop) {
    if (!this.anchors.length) return;
    let cur = this.anchors[0];
    this.anchors.forEach((a) => { if (a.top <= scrollTop + 40) cur = a; });
    if (!cur || !cur.cid || cur.idx === this.data.chIndex) return;
    const chs = (this.book.chapters || []);
    this.chapterId = cur.cid;
    const ch = store.getChapter(this.bookId, cur.cid);
    this.setData({
      chIndex: cur.idx,
      progressPct: chs.length ? Math.round(((cur.idx + 1) / chs.length) * 100) : 0,
      article: { id: cur.cid, title: (ch && ch.title) || '' },
      favored: store.isFavored(this.bookId, cur.cid),
      'toc.current': cur.cid
    });
    store.touchBook(this.bookId, cur.cid);
  },

  onPageScroll(e) {
    const top = e.scrollTop || 0;
    this.scrollTop = top;
    // 滑动立即收起顶栏/控制条，回到沉浸阅读
    if (this.data.ctl.show && Math.abs(top - this.lastScrollTop) > 3) {
      this.setData({ 'ctl.show': false });
    }
    this.lastScrollTop = top;
    this.updateCurrentChapter(top);
  },

  // ---------- 划线渲染（跨章：token id 已全局唯一） ----------
  buildMarksMap() {
    const m = {};
    this.chapters.forEach((c) => {
      (c.marks || []).forEach((r) => {
        for (let i = r.start; i <= r.end; i++) m[i + c.offset] = true;
      });
    });
    return m;
  },

  // 词间空格是否需要跟随划线着色：仅当空格两侧的词都在同一划线区间内
  buildSpaceMarks() {
    const m = {};
    this.chapters.forEach((c) => {
      (c.marks || []).forEach((r) => {
        for (let i = r.start; i < r.end; i++) m[i + c.offset] = true;
      });
    });
    return m;
  },

  refreshMarks() {
    this.setData({ marksMap: this.buildMarksMap(), spaceMarks: this.buildSpaceMarks() });
  },

  buildTransMap() {
    const map = {};
    this.chapters.forEach((c) => {
      const ch = store.getChapter(this.bookId, c.cid);
      const translations = (ch && ch.translations) || [];
      c.paras.forEach((p) => {
        const tr = translations[p.pid];
        if (tr) map[p.uid] = tr;
      });
    });
    return map;
  },

  buildNoteCounts() {
    const counts = {};
    this.chapters.forEach((c) => {
      (c.notes || []).forEach((n) => {
        const uid = this.findNotePara(c, n.sel);
        if (uid != null) counts[uid] = (counts[uid] || 0) + 1;
      });
    });
    return counts;
  },

  findNotePara(c, sel) {
    const s = normText(sel);
    if (!s) return null;
    let hit = c.paras.find((p) => p.text.indexOf(s) !== -1);
    if (!hit) {
      const head = s.slice(0, Math.max(12, Math.ceil(s.length / 3)));
      hit = c.paras.find((p) => p.text.indexOf(head) !== -1);
    }
    return hit ? hit.uid : null;
  },

  // ---------- 顶栏 / 底部控制条 ----------
  onBack() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/shelf/shelf' }) });
  },

  toggleCtl() {
    this.setData({ 'ctl.show': !this.data.ctl.show });
  },

  // 点正文空白处（单词以外的区域）：清选区 + 开关顶栏/控制条
  // 单词上用 catchtap 阻止冒泡，所以一次点击不会被处理两次
  onReaderTap() {
    if (this.data.bar.show || this.data.panel.show) {
      this.clearSelection();
      return;
    }
    this.cancelTap();
    this.clearSelection();
    this.toggleCtl();
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
    if (id && id !== this.chapterId) this.startAt(id);
  },

  onSlider(e) {
    const i = Number(e.detail.value);
    const ch = (this.book.chapters || [])[i];
    if (ch) this.startAt(ch.id);
  },

  prevChapter() {
    const i = this.data.chIndex;
    if (i <= 0) return wx.showToast({ title: '已经是第一章', icon: 'none' });
    this.startAt(this.book.chapters[i - 1].id);
  },

  nextChapter() {
    const i = this.data.chIndex;
    if (i >= this.data.chTotal - 1) return wx.showToast({ title: '已经是最后一章', icon: 'none' });
    this.startAt(this.book.chapters[i + 1].id);
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

  // ---------- 选择（单击立即切控制条，双击选词） ----------
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
    this.pendingToggle = false;
    this.lastTap = { id: null, time: 0 };
  },

  // 等 200ms：期间没有第二次点击 → 判定单击（开/关控制条）
  // 期间点了同一个词 → 判定双击（取消单击判定，选中该词）
  handleTap(id) {
    if (!this.lastTap) this.lastTap = { id: null, time: 0 };
    const now = Date.now();
    if (this.lastTap.id === id && now - this.lastTap.time < 200) {
      this.cancelTap();
      return this.selectRange(id, id);
    }
    this.lastTap = { id, time: now };
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => {
      this.tapTimer = null;
      this.lastTap = { id: null, time: 0 };
      this.toggleCtl();
    }, 200);
  },

  onLongPress(e) {
    this.cancelTap();
    this.longPressed = true;
    const id = e.currentTarget.dataset.id;
    const loc = this.findToken(id);
    if (!loc) return;
    let start = -1, end = -1;
    loc.para.tokens.forEach((t) => {
      if (t.sid === loc.token.sid) {
        if (start < 0) start = t.id;
        end = t.id;
      }
    });
    if (start >= 0) this.selectRange(start, end);
  },

  findToken(id) {
    for (let c = 0; c < this.chapters.length; c++) {
      const paras = this.chapters[c].paras;
      for (let i = 0; i < paras.length; i++) {
        const p = this.paraOf(paras[i].uid);
        if (!p || !p.tokens.length) continue;
        const arr = p.tokens;
        if (id >= arr[0].id && id <= arr[arr.length - 1].id) {
          const token = arr.find((x) => x.id === id);
          if (token) return { para: p, token, cid: paras[i].cid, offset: this.chapters[c].offset };
        }
      }
    }
    return null;
  },

  // 按 uid 从渲染流里取段落（含 tokens）
  paraOf(uid) {
    return this.blocks.find((b) => b.uid === uid && b.type === 'para') || null;
  },

  // 全局 token id → 所属章节记录
  chapterOf(id) {
    let hit = null;
    this.chapters.forEach((c) => {
      if (!hit && id >= c.offset) hit = c;
    });
    return hit;
  },

  allTokens() {
    const out = [];
    this.blocks.forEach((b) => {
      if (b.type === 'para') out.push.apply(out, b.tokens);
    });
    return out;
  },

  selectRange(start, end) {
    const tokens = this.allTokens().filter((t) => t.id >= start && t.id <= end);
    const text = joinTokens(tokens);
    const c = this.chapterOf(start);
    this.selCid = c ? c.cid : this.chapterId;
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
      const barW = 350, barH = 46;
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
    const cid = this.selCid || this.chapterId;

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
        chapterId: cid,
        bookTitle: this.book.title,
        chapterTitle: this.chapterTitleOf(cid)
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

  chapterTitleOf(cid) {
    const ch = store.getChapter(this.bookId, cid);
    return (ch && ch.title) || this.data.article.title || '';
  },

  // 收藏句子时尽量带上已缓存的句译
  sentenceTransOf(text) {
    const key = normText(text);
    let best = '';
    Object.keys(this.paraByUid).forEach((uid) => {
      const p = this.paraByUid[uid];
      if (p.text === key || p.text.indexOf(key) !== -1 || key.indexOf(p.text) !== -1) {
        const tr = this.data.transMap[uid];
        if (tr && !best) best = tr;
      }
    });
    return best;
  },

  addMark() {
    const { selStart: start, selEnd: end } = this.data;
    if (start < 0) return;
    const c = this.chapterOf(start);
    if (!c) return;
    const ls = start - c.offset, le = end - c.offset;
    const hit = c.marks.find((m) => m.start <= ls && m.end >= le);
    if (hit) {
      c.marks = store.removeMark(c.cid, hit);
      this.refreshMarks();
      this.clearSelection();
      wx.showToast({ title: '已取消划线', icon: 'none' });
      return;
    }
    c.marks = store.addMark(c.cid, {
      start: ls, end: le, text: this.data.selectedText, createdAt: Date.now()
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
    const cid = this.selCid || this.chapterId;
    store.addVocab({
      word: this.data.selectedText.trim(),
      phonetic: r.phonetic || '',
      pos: r.pos || '',
      translation: r.translation || '',
      fromBook: this.book.title,
      fromChapter: this.chapterTitleOf(cid),
      bookId: this.bookId,
      chapterId: cid,
      createdAt: Date.now()
    });
    wx.showToast({ title: '已加入生词本', icon: 'success' });
  },
  onSaveNote(e) {
    const note = (e.detail.note || '').trim();
    if (!note) return wx.showToast({ title: '笔记内容为空', icon: 'none' });
    const cid = this.selCid || this.chapterId;
    const c = this.chapters.find((x) => x.cid === cid) || this.chapters[0];
    if (!c) return;
    c.notes = store.addNote(cid, { note, sel: this.data.selectedText, createdAt: Date.now() });
    wx.showToast({ title: '笔记已保存', icon: 'success' });
    this.setData({ noteCounts: this.buildNoteCounts(), 'panel.show': false });
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
  onNoteBadge(e) {
    const uid = e.currentTarget.dataset.uid;
    const p = this.paraByUid[uid];
    if (!p) return;
    const c = this.chapters.find((x) => x.cid === p.cid);
    if (!c) return;
    const list = (c.notes || [])
      .map((n) => ({ n, uid: this.findNotePara(c, n.sel) }))
      .filter((x) => x.uid === uid)
      .map((x) => ({ sel: x.n.sel, note: x.n.note, createdAt: x.n.createdAt, timeText: fmtTime(x.n.createdAt) }));
    this.clearSelection();
    this.setData({ noteView: { show: true, pid: uid, list, paraText: p.raw } });
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
        const c = this.chapters.find((x) => (x.notes || []).some((n) => n.createdAt === item.createdAt));
        if (c) {
          c.notes = store.removeNote(c.cid, item);
          this.setData({ noteCounts: this.buildNoteCounts() });
        }
        const list = this.data.noteView.list.filter((x) => x.createdAt !== item.createdAt);
        this.setData({ 'noteView.list': list });
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
