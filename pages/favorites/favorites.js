// pages/favorites/favorites —— 收藏文章（章节）
const store = require('../../utils/store');
const theme = require('../../utils/theme');

Page({
  data: { list: [] },

  onShow() {
    theme.bindPage(this, -1);
    this.setData({ list: store.listFavors() });
  },

  open(e) {
    const { book, chapter } = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/reader/reader?bookId=' + book + '&chapterId=' + chapter });
  },

  remove(e) {
    const { book, chapter, title } = e.currentTarget.dataset;
    wx.showModal({
      title: '取消收藏',
      content: '取消收藏「' + title + '」？',
      confirmText: '取消收藏',
      confirmColor: '#E24B4A',
      success: (res) => {
        if (!res.confirm) return;
        store.toggleFavor({ bookId: book, chapterId: chapter });
        this.setData({ list: store.listFavors() });
        wx.showToast({ title: '已取消收藏', icon: 'none' });
      }
    });
  }
});
