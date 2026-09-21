// pages/mine/mine —— 我的：入口菜单
const store = require('../../utils/store');
const theme = require('../../utils/theme');

Page({
  data: {
    stat: { vocab: 0, sentences: 0, favors: 0 }
  },

  onShow() {
    theme.bindPage(this, 3);
    this.setData({
      stat: {
        vocab: store.getVocab().length,
        sentences: store.listSentences().length,
        favors: store.listFavors().length
      }
    });
  },

  go(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url });
  }
});
