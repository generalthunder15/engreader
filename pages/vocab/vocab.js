// pages/vocab/vocab.js —— 生词本：点击朗读，长按删除
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const tts = require('../../utils/tts');

Page({
  data: {
    vocab: []
  },

  onShow() {
    theme.bindPage(this, -1); // 主题注入（生词本现在是"我的"下的子页面）
    this.setData({ vocab: store.getVocab() });
  },

  playWord(e) {
    const word = e.currentTarget.dataset.word;
    tts.play(word).catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  removeWord(e) {
    const word = e.currentTarget.dataset.word;
    wx.showModal({
      title: '删除生词',
      content: `确定从生词本删除「${word}」吗？`,
      confirmText: '删除',
      confirmColor: '#E24B4A',
      success: (res) => {
        if (res.confirm) {
          this.setData({ vocab: store.deleteVocab(word) });
        }
      }
    });
  },

  onHide() {
    tts.stop();
  },
  onUnload() {
    tts.stop();
  }
});
