// pages/mine/mine.js —— 设置：大模型 API、朗读、数据备份/恢复
// 主题 / 阅读字体 / 排版设置已移至阅读页（单击正文呼出「阅读设置」抽屉）
const store = require('../../utils/store');
const theme = require('../../utils/theme');

Page({
  data: {
    form: { baseUrl: '', apiKey: '', model: '', ttsApiKey: '', autoPlay: false },
    importing: false,
    importText: '',
    stat: { articles: 0, vocab: 0, cache: 0 }
  },

  onShow() {
    theme.bindPage(this, 2); // 主题注入 + 字体加载 + 底栏选中态
    this.setData({ form: store.getSettings() });
    this.refreshStat();
  },

  refreshStat() {
    const cache = store.getAICache();
    this.setData({
      stat: {
        articles: store.listArticles().length,
        vocab: store.getVocab().length,
        cache: Object.keys(cache).length
      }
    });
  },

  onInput(e) {
    this.setData({ ['form.' + e.currentTarget.dataset.k]: e.detail.value });
  },
  onSwitch(e) {
    this.setData({ 'form.autoPlay': e.detail.value });
  },
  onSpeed(e) {
    this.setData({ 'form.ttsSpeed': e.detail.value });
  },
  saveSettings() {
    const f = this.data.form;
    const cur = store.getSettings();
    // 以当前完整设置为基底再覆盖，避免把主题 / 字体 / 排版设置冲掉
    store.setSettings(Object.assign({}, cur, {
      baseUrl: f.baseUrl.trim(),
      model: f.model.trim() || 'deepseek-v4-flash',
      apiKey: f.apiKey.trim(),
      ttsApiKey: f.ttsApiKey.trim(),
      autoPlay: !!f.autoPlay,
      ttsSpeed: Number(f.ttsSpeed) || 1
    }));
    wx.showToast({ title: '设置已保存', icon: 'success' });
  },

  // ---------- 备份 ----------
  exportBackup() {
    const json = JSON.stringify(store.exportAll());
    wx.setClipboardData({
      data: json,
      success: () => wx.showModal({
        title: '备份成功',
        content: `共 ${json.length} 字符，已复制到剪贴板。请粘贴到微信收藏、备忘录等处保存。`,
        showCancel: false
      })
    });
  },
  toggleImport() {
    this.setData({ importing: !this.data.importing, importText: '' });
  },
  onImportText(e) {
    this.setData({ importText: e.detail.value });
  },
  doImport() {
    let backup;
    try {
      backup = JSON.parse(this.data.importText.trim());
    } catch (e) {
      return wx.showToast({ title: 'JSON 格式不正确', icon: 'none' });
    }
    wx.showModal({
      title: '确认导入',
      content: '导入将覆盖当前的同名数据，确定继续吗？',
      success: (res) => {
        if (!res.confirm) return;
        try {
          const n = store.importAll(backup);
          this.setData({ importing: false, importText: '' });
          this.refreshStat();
          wx.showToast({ title: '已导入 ' + n + ' 项', icon: 'success' });
        } catch (err) {
          wx.showToast({ title: err.message, icon: 'none' });
        }
      }
    });
  },

  clearCache() {
    wx.showModal({
      title: '清空 AI 缓存',
      content: '清空后再次查询相同内容会重新调用 API，确定吗？',
      confirmColor: '#E24B4A',
      success: (res) => {
        if (res.confirm) {
          store.clearAICache();
          this.refreshStat();
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  }
});
