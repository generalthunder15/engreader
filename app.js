const store = require('./utils/store');
const theme = require('./utils/theme');
const font = require('./utils/font');

App({
  onLaunch() {
    // v3 数据迁移：清空旧"单篇文章"模型数据（生词本/设置/主题/字体保留）
    store.migrate();

    // 首次启动注入内置书（四级/考研分级阅读，翻译已预缓存）
    store.seedBuiltIns();

    // 初始化默认设置（大模型 API 配置 + 主题 + 字体）
    const s = store.getSettings();
    store.setSettings(s);

    // 字体：wx.loadFontFace 加载的字体只在本次会话有效，冷启动必须重新加载一次
    theme.applyFonts();

    // 清理用户目录里已无索引的字体残留（换包/删字体后可能留下孤儿文件）
    font.gc();
  },
  globalData: {}
});
