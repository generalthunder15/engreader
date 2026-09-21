// pages/index/index.js —— 文章列表 + 导入
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const { tokenizeArticle } = require('../../utils/tokenize');

const SAMPLE_TITLE = 'The Power of Habits (Sample)';
const SAMPLE_CONTENT =
  "Habits are the compound interest of self-improvement. " +
  "The same way that money multiplies through compound interest, the effects of your habits multiply as you repeat them. " +
  "They seem to make little difference on any given day, and yet the impact they deliver over the months and years can be enormous. " +
  "It is only when looking back two, five, or perhaps ten years later that the value of good habits and the cost of bad ones becomes strikingly clear.\n" +
  "This is a sample article for testing. Try tapping a single word to look it up, or long-pressing to select a whole sentence. " +
  "You can also drag across several words to select a phrase, then use the toolbar to translate, parse grammar, read aloud, highlight, or take notes.";

Page({
  data: {
    articles: [],
    importing: false,
    panelBottom: 50, // 导入面板离屏幕底部的距离（px）：平时 = 底栏高度，键盘弹起 = 键盘高度
    form: { title: '', content: '' }
  },

  onLoad() {
    // 底栏高度（px）= 100rpx + 底部安全区。面板直接锚在其上方，不与底栏做层级竞争
    try {
      const wi = wx.getWindowInfo();
      const inset = wi.safeArea ? wi.screenHeight - wi.safeArea.bottom : 0;
      this.tabBarPx = Math.round(wi.windowWidth / 7.5) + inset; // 100rpx = windowWidth / 7.5
    } catch (e) {
      this.tabBarPx = 50;
    }
  },

  onShow() {
    theme.bindPage(this, 0); // 主题注入 + 底栏选中态
    this.setData({ articles: store.listArticles() });
  },

  openArticle(e) {
    wx.navigateTo({ url: '/pages/reader/reader?id=' + e.currentTarget.dataset.id });
  },

  deleteArticle(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '删除文章',
      content: '文章及其划线、笔记将一并删除，确定吗？',
      confirmText: '删除',
      confirmColor: '#E24B4A',
      success: (res) => {
        if (res.confirm) {
          store.deleteArticle(id);
          this.setData({ articles: store.listArticles() });
        }
      }
    });
  },

  // ---- 导入 ----
  showImport() {
    this.setData({ importing: true, panelBottom: this.tabBarPx || 50, form: { title: '', content: '' } });
  },
  hideImport() {
    this.setData({ importing: false });
  },
  // 输入法弹起/收起：面板抬到键盘上方；收起时落回底栏上方
  onKbChange(e) {
    const kb = (e.detail && e.detail.height) || 0;
    this.setData({ panelBottom: kb > 0 ? kb : (this.tabBarPx || 50) });
  },
  onTitleBlur() {
    this.setData({ panelBottom: this.tabBarPx || 50 });
  },
  onContentBlur() {
    this.setData({ panelBottom: this.tabBarPx || 50 });
  },
  // 一键粘贴：直接读剪贴板追加到正文
  pasteFromClip() {
    wx.getClipboardData({
      success: (r) => {
        const t = (r.data || '').trim();
        if (!t) return wx.showToast({ title: '剪贴板是空的', icon: 'none' });
        this.setData({ 'form.content': this.data.form.content + t });
        wx.showToast({ title: '已粘贴', icon: 'success' });
      }
    });
  },
  onTitle(e) {
    this.setData({ 'form.title': e.detail.value });
  },
  onContent(e) {
    this.setData({ 'form.content': e.detail.value });
  },
  saveImport() {
    const { title, content } = this.data.form;
    if (!content.trim()) return wx.showToast({ title: '请先粘贴文章内容', icon: 'none' });
    const art = tokenizeArticle(
      title.trim() || '未命名文章 ' + new Date().toLocaleDateString(),
      content
    );
    if (!art.tokenCount) {
      wx.showToast({ title: '未识别到英文内容', icon: 'none' });
      return;
    }
    art.id = store.newId();
    art.createdAt = Date.now();
    art.splitVer = 2;
    store.saveArticle(art);
    this.setData({ importing: false, articles: store.listArticles() });
    wx.navigateTo({ url: '/pages/reader/reader?id=' + art.id });
  },

  loadSample() {
    const art = tokenizeArticle(SAMPLE_TITLE, SAMPLE_CONTENT);
    art.id = store.newId();
    art.createdAt = Date.now();
    art.splitVer = 2;
    store.saveArticle(art);
    this.setData({ articles: store.listArticles() });
    wx.navigateTo({ url: '/pages/reader/reader?id=' + art.id });
  }
});
