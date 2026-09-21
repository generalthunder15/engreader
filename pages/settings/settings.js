// pages/settings/settings —— 系统设置：AI API 配置 / 闯关词数 / 朗读 / 数据管理
const store = require('../../utils/store');
const theme = require('../../utils/theme');

Page({
  data: {
    form: {},
    stat: {},
    importing: false,
    importText: ''
  },

  onShow() {
    theme.bindPage(this, -1);
    const s = store.getSettings();
    this.setData({
      form: {
        baseUrl: s.baseUrl,
        model: s.model,
        apiKey: s.apiKey,
        sfBaseUrl: s.sfBaseUrl,
        sfModel: s.sfModel,
        sfApiKey: s.sfApiKey,
        ttsApiKey: s.ttsApiKey,
        autoPlay: s.autoPlay,
        ttsSpeed: s.ttsSpeed,
        quizCount: s.quizCount
      },
      stat: {
        books: store.listBooks().length,
        vocab: store.getVocab().length,
        cache: Object.keys(store.getAICache()).length
      }
    });
  },

  onInput(e) {
    const k = e.currentTarget.dataset.k;
    this.setData({ ['form.' + k]: e.detail.value });
  },

  onSwitch(e) {
    this.setData({ 'form.autoPlay': e.detail.value });
  },

  onSpeed(e) {
    this.setData({ 'form.ttsSpeed': e.detail.value });
  },

  onQuizCount(e) {
    this.setData({ 'form.quizCount': Number(e.detail.value) });
  },

  saveSettings() {
    const s = store.getSettings();
    const f = this.data.form;
    const qc = Number(f.quizCount);
    Object.assign(s, {
      baseUrl: f.baseUrl.trim(),
      model: f.model.trim(),
      apiKey: f.apiKey.trim(),
      sfBaseUrl: f.sfBaseUrl.trim(),
      sfModel: f.sfModel.trim(),
      sfApiKey: f.sfApiKey.trim(),
      ttsApiKey: f.ttsApiKey.trim(),
      autoPlay: !!f.autoPlay,
      ttsSpeed: f.ttsSpeed,
      quizCount: qc >= 5 && qc <= 100 ? qc : 30
    });
    store.setSettings(s);
    wx.showToast({ title: '已保存', icon: 'success' });
  },

  exportBackup() {
    const data = JSON.stringify(store.exportAll());
    wx.setClipboardData({
      data,
      success: () => wx.showToast({ title: '备份已复制到剪贴板', icon: 'none' })
    });
  },

  toggleImport() {
    this.setData({ importing: !this.data.importing, importText: '' });
  },

  onImportText(e) {
    this.setData({ importText: e.detail.value });
  },

  doImport() {
    try {
      const n = store.importAll(JSON.parse(this.data.importText));
      wx.showToast({ title: '已导入 ' + n + ' 项', icon: 'success' });
      this.setData({ importing: false });
      this.onShow();
    } catch (e) {
      wx.showModal({ title: '导入失败', content: e.message || 'JSON 格式不正确', showCancel: false });
    }
  },

  clearCache() {
    wx.showModal({
      title: '清空 AI 缓存',
      content: '清空后相同的查词/翻译请求会重新调用 API（不影响书籍与学习数据）。',
      confirmColor: '#E24B4A',
      success: (res) => {
        if (!res.confirm) return;
        store.clearAICache();
        this.onShow();
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    });
  }
});
