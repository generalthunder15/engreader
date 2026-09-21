// pages/shelf/shelf —— 书架：以书籍为单位管理阅读内容
const store = require('../../utils/store');
const theme = require('../../utils/theme');

Page({
  data: {
    books: []
  },

  onShow() {
    theme.bindPage(this, 1);
    this.refresh();
  },

  refresh() {
    const books = store.listBooks().map((b) => ({
      id: b.id,
      title: b.title,
      author: b.author,
      hue: b.hue || 210,
      chapterCount: b.chapterCount || 0,
      coverStyle:
        'background:hsl(' + b.hue + ',42%,86%);color:hsl(' + b.hue + ',45%,32%)',
      timeText: b.lastReadAt ? this.fmtDate(b.lastReadAt) : '未读'
    }));
    this.setData({ books });
  },

  fmtDate(ts) {
    const d = new Date(ts);
    const p = (x) => (x < 10 ? '0' + x : '' + x);
    return d.getMonth() + 1 + '月' + d.getDate() + '日读';
  },

  createBook() {
    wx.showModal({
      title: '新建书籍',
      editable: true,
      placeholderText: '输入书名',
      success: (res) => {
        if (!res.confirm) return;
        const title = (res.content || '').trim();
        if (!title) return wx.showToast({ title: '书名不能为空', icon: 'none' });
        const book = store.createBook({ title });
        this.refresh();
        wx.navigateTo({ url: '/pages/book/book?id=' + book.id });
      }
    });
  },

  openBook(e) {
    wx.navigateTo({ url: '/pages/book/book?id=' + e.currentTarget.dataset.id });
  },

  removeBook(e) {
    const { id, title } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除书籍',
      content: '删除《' + title + '》及其全部章节、划线和笔记？此操作不可恢复。',
      confirmText: '删除',
      confirmColor: '#E24B4A',
      success: (res) => {
        if (!res.confirm) return;
        store.deleteBook(id);
        this.refresh();
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  }
});
