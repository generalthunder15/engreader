// pages/sentences/sentences —— 收藏句子
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const tts = require('../../utils/tts');

Page({
  data: { list: [] },

  onShow() {
    theme.bindPage(this, -1);
    this.setData({ list: store.listSentences() });
  },

  play(e) {
    tts.play(e.currentTarget.dataset.text).catch((err) => wx.showToast({ title: err.message, icon: 'none' }));
  },

  remove(e) {
    const { id, text } = e.currentTarget.dataset;
    wx.showModal({
      title: '删除收藏',
      content: '删除「' + (text.length > 20 ? text.slice(0, 20) + '…' : text) + '」？',
      confirmText: '删除',
      confirmColor: '#E24B4A',
      success: (res) => {
        if (!res.confirm) return;
        this.setData({ list: store.removeSentence(id) });
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  },

  onHide() { tts.stop(); },
  onUnload() { tts.stop(); }
});
