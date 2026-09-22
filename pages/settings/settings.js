// pages/settings/settings —— 系统设置：AI API 配置 / 闯关词数 / 朗读 / 数据管理
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const net = require('../../utils/net');
const llm = require('../../utils/llm');
const dict = require('../../utils/dict');
const ai = require('../../utils/ai');

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
        quizCount: s.quizCount,
        localFallback: s.localFallback
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

  onFallbackSwitch(e) {
    this.setData({ 'form.localFallback': e.detail.value });
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
      quizCount: qc >= 5 && qc <= 100 ? qc : 30,
      localFallback: !!f.localFallback
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

  // 一键自检：域名放行情况 → 词典 → 逐项验证每个 AI 能力
  runDiag() {
    if (this.data.testing) return;
    const push = (line) => this.setData({ testLog: this.data.testLog + '\n' + line });

    const s = store.getSettings();
    this.setData({
      testing: true,
      testLog:
        '接口：' + s.baseUrl + '\n模型：' + s.model +
        '\nKey：' + (s.apiKey ? s.apiKey.slice(0, 8) + '…' + s.apiKey.slice(-4) : '（未配置）') +
        '\n本地兜底：' + (s.localFallback ? '开（网络失败时用内置词库顶上）' : '关（暴露真实错误）')
    });

    const timed = (name, fn, fmt) => {
      const t0 = Date.now();
      return fn()
        .then((r) => push('✅ ' + name + '（' + (Date.now() - t0) + 'ms）' + (fmt ? ' → ' + fmt(r) : '')))
        .catch((e) => push('❌ ' + name + '（' + (Date.now() - t0) + 'ms）→ ' + (e && e.message ? String(e.message).replace(/\s+/g, ' ').slice(0, 120) : '未知错误')));
    };

    Promise.all(net.DOMAINS.map((d) => net.probe(d)))
      .then((rs) => {
        push('');
        rs.forEach((r) => {
          const mark = r.ok ? '✅ ' : (r.optional ? '⚠️ ' : '❌ ');
          push(mark + r.host + '（' + r.use + '）— ' + (r.ok ? '通 ' + r.ms + 'ms' : r.code));
        });
        const blocked = rs.filter((r) => !r.ok && !r.optional);
        if (blocked.length) {
          push('\n⚠️ ' + blocked.length + ' 个关键域名不通：真机点右上角「···」开「开发调试」；' +
            '开发者工具勾选「不校验合法域名」；长期用见「复制域名清单」。');
        }

        // 词典（不经 AI）：清掉该词的本地缓存，确保每次都真实联网
        push('\n—— 词典 ——');
        const dw = 'serendipity';
        try { wx.removeStorageSync('dict_' + store.hash(dw)); } catch (e) {}
        return timed('有道词典 ' + dw, () => dict.lookup(dw), (r) => r.translation.slice(0, 30));
      })
      .then(() => {
        push('\n—— AI 能力 ——');
        const stamp = Date.now();
        // 用唯一文本避免命中本地缓存，确保每次都真发请求
        return timed('单词翻译 llm.ask(word)', () => llm.ask({ type: 'word', text: 'migrate_' + stamp }),
          (r) => r.result.translation.slice(0, 24));
      })
      .then(() => timed('句子翻译 llm.ask(sentence)',
        () => llm.ask({ type: 'sentence', text: 'Habits are the compound interest of self-improvement ' + Date.now() + '.' }),
        (r) => r.result.translation.slice(0, 24)))
      .then(() => timed('批量句译 ai.batchTranslate',
        () => ai.batchTranslate(['Rain fell softly ' + Date.now() + '.', 'She opened the door slowly.']),
        (r) => (r[0] || '(空)').slice(0, 24)))
      .then(() => timed('词表提取 ai.extractWords',
        () => ai.extractWords('Mornings in this quiet town begin with the smell of fresh bread ' + Date.now() + '.'),
        (r) => r.length + ' 词：' + r.slice(0, 2).map((x) => x.word).join('/')))
      .then(() => timed('学习教练 ai.studyChat',
        () => ai.studyChat({ phase: 'assess', profile: '', bookshelf: '（自检）', history: [], userMsg: '开始摸底 ' + Date.now() }),
        (r) => (r.reply || '(空)').slice(0, 24)))
      .then(() => {
        push('\n内置离线词库：' + dict.offlineSize() + ' 条');
        push('（上方全绿 = API/AI 完全正常；单词失败但词典成功 = 只是 AI 域名问题）');
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
