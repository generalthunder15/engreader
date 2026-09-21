// pages/chapter-edit/chapter-edit —— 创建/编辑章节
// 规则：章节必须带有「本章单词/短语」词表（AI 提取 + 手动增删），保存时批量句译缓存
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const ai = require('../../utils/ai');
const { tokenizeArticle } = require('../../utils/tokenize');

Page({
  data: {
    title: '',
    content: '',
    words: [],          // [{word, meaning}]
    extracting: false,
    saving: false,
    saveStep: '',
    isEdit: false,
    wordCount: 0
  },

  onLoad(options) {
    theme.bindPage(this, -1);
    this.bookId = options.bookId;
    this.chapterId = options.chapterId || null;
    if (this.chapterId) {
      const ch = store.getChapter(this.bookId, this.chapterId);
      if (!ch) {
        wx.showToast({ title: '章节不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 800);
        return;
      }
      this.orig = ch;
      this.setData({
        isEdit: true,
        title: ch.title,
        content: ch.rawText || '',
        words: (ch.words || []).map((w) => ({ word: w.word, meaning: w.meaning || '' })),
        wordCount: (ch.words || []).length
      });
      wx.setNavigationBarTitle({ title: '编辑章节' });
    }
  },

  onTitle(e) { this.setData({ title: e.detail.value }); },
  onContent(e) { this.setData({ content: e.detail.value }); },

  // ---------- AI 提取词表 ----------
  extractWords() {
    const { content, extracting } = this.data;
    if (extracting) return;
    if (!content.trim()) return wx.showToast({ title: '请先粘贴章节正文', icon: 'none' });
    this.setData({ extracting: true });
    ai.extractWords(content)
      .then((words) => {
        this.setData({ words, wordCount: words.length, extracting: false });
        wx.showToast({ title: '提取到 ' + words.length + ' 个词', icon: 'success' });
      })
      .catch((err) => {
        this.setData({ extracting: false });
        wx.showModal({ title: '提取失败', content: err.message || '请稍后重试', showCancel: false });
      });
  },

  onWordInput(e) {
    const { i, f } = e.currentTarget.dataset;
    this.setData({ ['words[' + i + '].' + f]: e.detail.value });
  },

  addWordRow() {
    this.setData({ words: this.data.words.concat([{ word: '', meaning: '' }]) });
  },

  removeWordRow(e) {
    const i = e.currentTarget.dataset.i;
    const words = this.data.words.slice();
    words.splice(i, 1);
    this.setData({ words, wordCount: words.length });
  },

  // ---------- 保存 ----------
  save() {
    const { title, content, words, saving } = this.data;
    if (saving) return;
    if (!title.trim()) return wx.showToast({ title: '请填写章节标题', icon: 'none' });
    if (!content.trim()) return wx.showToast({ title: '请填写章节正文', icon: 'none' });
    const cleanWords = words
      .map((w) => ({ word: w.word.trim(), meaning: w.meaning.trim() }))
      .filter((w) => w.word);
    if (!cleanWords.length) {
      return wx.showToast({ title: '词表不能为空：先「AI提取词表」或手动添加', icon: 'none' });
    }

    const tokens = tokenizeArticle(title, content);
    if (!tokens.paragraphs.length) {
      return wx.showToast({ title: '正文解析失败，请检查内容', icon: 'none' });
    }

    this.setData({ saving: true, saveStep: '正在分句…' });

    // 内容没变且旧章节已有翻译 → 不重复翻译
    const reuseTrans =
      this.orig &&
      this.orig.rawText === content &&
      Array.isArray(this.orig.translations) &&
      this.orig.translations.length === tokens.sentences.length &&
      this.orig.translations.some((t) => t);

    const ensureTrans = reuseTrans
      ? Promise.resolve(this.orig.translations)
      : ai
          .translateAll(tokens.sentences, (done, total) =>
            this.setData({ saveStep: '翻译中 ' + done + '/' + total + ' 句…' })
          )
          .then((arr) => {
            if (!arr.some((t) => t)) throw new Error('翻译失败：请检查网络与硅基流动配置');
            return arr;
          });

    ensureTrans
      .then((translations) => {
        this.setData({ saveStep: '正在保存…' });
        const ch = {
          id: this.chapterId || store.newId(),
          bookId: this.bookId,
          title: title.trim(),
          rawText: content,
          tokens: {
            paragraphs: tokens.paragraphs,
            sentences: tokens.sentences,
            tokenCount: tokens.tokenCount
          },
          words: cleanWords,
          translations,
          translatedAt: Date.now(),
          quizDone: this.orig ? !!this.orig.quizDone : false,
          createdAt: this.orig ? this.orig.createdAt : Date.now()
        };
        store.saveChapter(this.bookId, ch);
        this.chapterId = ch.id;
        this.orig = ch;
        this.setData({ saving: false, saveStep: '', isEdit: true });
        wx.showToast({ title: '已保存', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 600);
      })
      .catch((err) => {
        this.setData({ saving: false, saveStep: '' });
        wx.showModal({ title: '保存失败', content: err.message || '请稍后重试', showCancel: false });
      });
  }
});
