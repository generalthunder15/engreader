// pages/settings/settings —— 系统设置：AI API 配置 / 闯关词数 / 朗读 / 数据管理
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const net = require('../../utils/net');
const llm = require('../../utils/llm');
const dict = require('../../utils/dict');

Page({
  data: {
    form: {},
    stat: {},
    importing: false,
    importText: '',
    testing: false,
    testLog: ''
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

  // 一键自检：先探明 3 个外部域名是否放行，再真实跑一次 AI 查词
  runDiag() {
    if (this.data.testing) return;
    this.setData({ testing: true, testLog: '正在检测…' });
    const push = (line) => this.setData({ testLog: this.data.testLog + '\n' + line });

    const s = store.getSettings();
    let log = 'AI 接口：' + s.baseUrl + '\n模型：' + s.model + '\nKey：' +
      (s.apiKey ? s.apiKey.slice(0, 8) + '…' + s.apiKey.slice(-4) : '（未配置）');
    this.setData({ testLog: log });

    Promise.all(net.DOMAINS.map((d) => net.probe(d)))
      .then((rs) => {
        rs.forEach((r) => {
          push((r.ok ? '✅ ' : '❌ ') + r.host + '（' + r.use + '）— ' +
            (r.ok ? '通 ' + r.ms + 'ms' : r.code));
        });
        const blocked = rs.filter((r) => !r.ok);
        if (blocked.length) {
          push('\n⚠️ 有 ' + blocked.length + ' 个域名不通：真机请点右上角「···」开「开发调试」；' +
            '开发者工具请勾选「不校验合法域名」；长期使用见下方「复制域名清单」。');
        }
        // 真实跑一次 AI 查词（走独立缓存键，不污染用户数据）
        const t0 = Date.now();
        return llm.ask({ type: 'word', text: 'diagnose_' + Date.now() })
          .then(() => push('\n✅ AI 查词成功（' + (Date.now() - t0) + 'ms）'))
          .catch((e) => push('\n❌ AI 查词失败：' + e.message));
      })
      .then(() => {
        push('\n内置离线词库：' + dict.offlineSize() + ' 条（无需网络，单词查询兜底）');
        this.setData({ testing: false });
      })
      .catch((e) => {
        push('\n❌ 自检异常：' + (e && e.message));
        this.setData({ testing: false });
      });
  },

  copyDomains() {
    wx.setClipboardData({
      data: net.DOMAIN_TEXT,
      success: () => wx.showToast({ title: '域名已复制，去 mp 后台添加', icon: 'none' })
    });
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
