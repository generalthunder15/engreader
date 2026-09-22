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
  },

  // ---------- 清除数据 ----------
  onClearData() {
    wx.showActionSheet({
      itemList: ['清除学习数据（保留 API 设置）', '清除全部（含 API Key 与设置）'],
      success: (res) => {
        if (res.tapIndex === 0) this.confirmClear(false);
        else if (res.tapIndex === 1) this.confirmClear(true);
      },
      fail: () => {}
    });
  },

  confirmClear(includeSettings) {
    const content = includeSettings
      ? '将清除：自建书、生词本、收藏、划线与笔记、学习记录、AI 缓存，以及 API Key 等全部设置。内置书保留。此操作不可恢复。'
      : '将清除：自建书、生词本、收藏、划线与笔记、学习记录、AI 缓存；内置书保留但重置为未读（正文/词表/句译保留）。API Key 与设置保留。此操作不可恢复。';
    wx.showModal({
      title: '确认清除数据',
      content: content,
      confirmText: '确认清除',
      confirmColor: '#E24B4A',
      success: (r) => { if (r.confirm) this.doClear(includeSettings); }
    });
  },

  doClear(includeSettings) {
    wx.showLoading({ title: '清除中', mask: true });
    // 让 loading 先渲染出来，再执行同步的删除循环
    setTimeout(() => {
      let info = null;
      try {
        info = store.clearUserData({ includeSettings: includeSettings });
      } catch (e) {
        wx.hideLoading();
        return wx.showModal({ title: '清除失败', content: (e && e.message) || '请稍后重试', showCancel: false });
      }
      wx.hideLoading();
      wx.showModal({
        title: '清除完成',
        content:
          '已删除 ' + info.removed + ' 条本地数据，保留内置书 ' + info.keptBooks + ' 本。' +
          (info.reseed ? '缺失的内置书会在下次启动时重新注入。' : '') +
          (info.settingsCleared ? '设置已恢复默认（含 API Key）。' : ''),
        showCancel: false
      });
      theme.bindPage(this, 3);
      this.onShow();
    }, 50);
  }
});
