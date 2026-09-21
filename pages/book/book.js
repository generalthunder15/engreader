// pages/book/book —— 书籍详情：章节列表 + 继续阅读 + 添加/删除章节
const store = require('../../utils/store');
const theme = require('../../utils/theme');

Page({
  data: {
    book: null,
    chapters: [],
    coverStyle: ''
  },

  onLoad(options) {
    this.bookId = options.id;
  },

  onShow() {
    theme.bindPage(this, -1);
    this.refresh();
  },

  refresh() {
    const b = store.getBook(this.bookId);
    if (!b) {
      wx.showToast({ title: '书籍不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    const chapters = (b.chapters || []).map((c, i) => ({
      id: c.id,
      title: c.title || '第' + (i + 1) + '章',
      wordCount: c.wordCount || 0,
      translated: c.translated,
      quizDone: c.quizDone
    }));
    this.setData({
      book: b,
      chapters,
      coverStyle: 'background:hsl(' + (b.hue || 210) + ',42%,86%);color:hsl(' + (b.hue || 210) + ',45%,32%)'
    });
    wx.setNavigationBarTitle({ title: b.title });
  },

  continueRead() {
    const b = this.data.book;
    const cid = b.lastChapterId || (b.chapters && b.chapters[0] && b.chapters[0].id);
    if (!cid) return wx.showToast({ title: '先添加一个章节吧', icon: 'none' });
    wx.navigateTo({ url: '/pages/reader/reader?bookId=' + b.id + '&chapterId=' + cid });
  },

  addChapter() {
    wx.navigateTo({ url: '/pages/chapter-edit/chapter-edit?bookId=' + this.bookId });
  },

  editChapter(e) {
    const { id, title } = e.currentTarget.dataset;
    if (title === '__add__') return;
    wx.navigateTo({ url: '/pages/chapter-edit/chapter-edit?bookId=' + this.bookId + '&chapterId=' + id });
  },

  openChapter(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/reader/reader?bookId=' + this.bookId + '&chapterId=' + id });
  },

  removeChapter(e) {
    const { id, title } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除章节',
      content: '删除「' + title + '」？章节内容、划线与笔记会一并删除。',
      confirmText: '删除',
      confirmColor: '#E24B4A',
      success: (res) => {
        if (!res.confirm) return;
        store.deleteChapter(this.bookId, id);
        this.refresh();
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  }
});
