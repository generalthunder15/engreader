// pages/quiz/quiz —— 单词闯关（参考"不背单词"看词选义）
// 规则：4 选 1；答对进入下一个；答错爆红并高亮正确答案，错词重新入队直到全部通过
// 内容：默认取生词本最近 N 个（N 可在系统设置调整）；章节模式（bookId+chapterId）用本章词表
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const ai = require('../../utils/ai');
const tts = require('../../utils/tts');

Page({
  data: {
    mode: 'vocab',      // vocab | chapter
    headTitle: '单词闯关',
    loading: false,
    phase: 'idle',      // idle | running | done
    cur: null,          // {word, meaning, options:[], answer}
    picked: -1,
    result: '',         // '' | right | wrong
    remain: 0,
    total: 0,
    right: 0,
    wrong: 0,
    passed: 0,          // 一次性答对的词数
    chapterDoneSaved: false
  },

  onLoad(options) {
    this.bookId = options.bookId || '';
    this.chapterId = options.chapterId || '';
    this.dayThemeId = 'default';
  },

  onShow() {
    theme.bindPage(this, 0);
    const cur = theme.currentId();
    if (cur !== 'night') this.dayThemeId = cur;
    if (this.data.phase === 'idle' && !this._loaded) this.start();
  },

  start() {
    const isChapter = !!(this.bookId && this.chapterId);
    this.setData({ mode: isChapter ? 'chapter' : 'vocab', loading: true, chapterDoneSaved: false });
    const load = isChapter
      ? Promise.resolve(this.loadChapterWords())
      : Promise.resolve(this.loadVocabWords());

    load.then((words) => {
      if (!words.length) {
        this.setData({
          loading: false,
          phase: 'done',
          headTitle: isChapter ? '本章闯关' : '单词闯关',
          total: 0
        });
        return null;
      }
      // 缺释义的先批量补（生词本里可能有无释义的词）
      const missing = words.filter((w) => !w.meaning);
      const ensure = missing.length ? ai.fillMeanings(words) : Promise.resolve(words);
      return ensure.then((ws) => {
        if (isChapter) this.chapterWords = ws;
        else this.persistMeanings(ws);
        this.begin(ws);
      });
    })
      .catch((err) => {
        this.setData({ loading: false });
        wx.showModal({ title: '加载失败', content: err.message || '请稍后重试', showCancel: false });
      });
  },

  loadVocabWords() {
    const n = store.getSettings().quizCount || 30;
    const vocab = store.getVocab().slice(0, n); // 已按加入时间倒序
    return vocab.map((v) => ({ word: v.word, meaning: v.translation || v.meaning || '' }));
  },

  loadChapterWords() {
    const ch = store.getChapter(this.bookId, this.chapterId);
    if (!ch) return [];
    const b = store.getBook(this.bookId);
    this.setData({ headTitle: (b ? b.title + ' · ' : '') + (ch.title || '本章闯关') });
    return (ch.words || []).map((w) => ({ word: w.word, meaning: w.meaning || '' }));
  },

  // 生词本闯关补出的释义写回存储，下次不用再查
  persistMeanings(words) {
    const vocab = store.getVocab();
    let dirty = false;
    vocab.forEach((v) => {
      if (v.translation) return;
      const hit = words.find((w) => w.word === v.word && w.meaning);
      if (hit) {
        v.translation = hit.meaning;
        dirty = true;
      }
    });
    if (dirty) store.setVocab(vocab);
  },

  begin(words) {
    const usable = words.filter((w) => w.word && w.meaning);
    const skipped = words.length - usable.length;
    if (!usable.length) {
      this.setData({ loading: false, phase: 'done', total: 0 });
      wx.showToast({ title: '没有可测试的词', icon: 'none' });
      return;
    }
    if (skipped) wx.showToast({ title: skipped + ' 个词缺少释义已跳过', icon: 'none' });
    this.words = usable;
    this.queue = usable.map((_, i) => i);
    this.firstTry = {};
    this.setData({
      loading: false,
      phase: 'running',
      total: usable.length,
      remain: usable.length,
      right: 0,
      wrong: 0,
      passed: 0
    });
    this.next();
  },

  buildOptions(curIdx) {
    const cur = this.words[curIdx];
    const pool = this.words
      .map((w, i) => ({ i, meaning: w.meaning }))
      .filter((x) => x.i !== curIdx && x.meaning !== cur.meaning);
    // 洗牌取 3 个干扰项
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const distractors = pool.slice(0, 3).map((x) => x.meaning);
    const options = distractors.concat([cur.meaning]);
    // 打乱选项顺序
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }
    return { options, answer: options.indexOf(cur.meaning) };
  },

  next() {
    if (!this.queue.length) return this.finish();
    const curIdx = this.queue.shift();
    const cur = this.words[curIdx];
    const { options, answer } = this.buildOptions(curIdx);
    this.curIdx = curIdx;
    this.setData({
      cur: { word: cur.word, meaning: cur.meaning, options, answer },
      picked: -1,
      result: '',
      remain: this.queue.length + 1
    });
    tts.play(cur.word).catch(() => {});
  },

  pick(e) {
    const i = Number(e.currentTarget.dataset.i);
    if (this.data.result) return; // 已判定，等待进入下一题
    const ok = i === this.data.cur.answer;
    this.setData({ picked: i, result: ok ? 'right' : 'wrong' });
    if (ok) {
      this.setData({ right: this.data.right + 1 });
      if (this.firstTry[this.curIdx] === undefined) {
        this.firstTry[this.curIdx] = true;
        this.setData({ passed: this.data.passed + 1 });
      }
      setTimeout(() => this.next(), 450);
    } else {
      this.setData({ wrong: this.data.wrong + 1 });
      this.firstTry[this.curIdx] = false;
      // 错词重新入队尾部，直到全部答对
      this.queue.push(this.curIdx);
      setTimeout(() => this.next(), 1300);
    }
  },

  speak() {
    if (this.data.cur) tts.play(this.data.cur.word).catch(() => {});
  },

  finish() {
    // 章节模式：标记本章闯关完成；若在学习计划里，同步标记
    if (this.data.mode === 'chapter' && !this.data.chapterDoneSaved) {
      store.patchChapter(this.bookId, this.chapterId, { quizDone: true });
      const st = store.getStudy();
      if (st.plan && Array.isArray(st.plan.chapters)) {
        let changed = false;
        st.plan.chapters.forEach((c) => {
          if (c.bookId === this.bookId && c.chapterId === this.chapterId && !c.done) {
            c.done = true;
            changed = true;
          }
        });
        if (changed) store.setStudy({ plan: st.plan });
      }
      this.setData({ chapterDoneSaved: true });
    }
    this.setData({ phase: 'done', remain: 0, cur: null });
  },

  restart() {
    this.begin(this.words);
  },

  goVocab() {
    wx.navigateTo({ url: '/pages/vocab/vocab' });
  },

  goStudy() {
    wx.switchTab({ url: '/pages/study/study' });
  },

  onHide() { tts.stop(); },
  onUnload() { tts.stop(); }
});
