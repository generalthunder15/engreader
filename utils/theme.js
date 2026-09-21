// utils/theme.js —— 主题内核（token 清单 + 内置主题包 + 运行时解析）
//
// 换肤原理（微信限制决定了实现方式）：
// 1. WXSS 不能在运行时替换，所以颜色/尺寸全部走 CSS 变量，由页面根节点的 style 注入；
//    页面内的组件（ai-panel / selection-toolbar）会自动继承这些变量。
// 2. 图片（背景图、底栏图标）不能用 wxss 的 url() 引用本地文件，统一用 <image src> 渲染。
// 3. 底栏图标必须在 custom-tab-bar 组件里渲染，原生 tabBar 只认包内图片。
// 4. 导航栏只能在运行时用 wx.setNavigationBarColor 改。
// 5. 字体由 utils/font.js 提供（loadFontFace 加载 + CSS 变量注入），主题只声明「推荐字体」。

const store = require('./store');
const font = require('./font');

// ---------- token 清单（值为「经典蓝」主题，即默认兜底）----------
const DEFAULT_TOKENS = {
  // 品牌与交互
  'c-primary': '#2B6CB0',
  'c-primary-weak': '#EAF1FA',
  'c-primary-soft': '#EBF2FC',
  'c-primary-quote': '#F3F6FB',
  'c-on-primary': '#FFFFFF',
  // 背景层次
  'c-bg': '#F6F7F9',
  'c-card': '#FFFFFF',
  'c-sunken': '#FAFBFC',
  'c-mask': 'rgba(0,0,0,0.35)',
  // 文字
  'c-text': '#1A1D24',
  'c-text-strong': '#22242A',
  'c-text-sub': '#4B5563',
  'c-text-muted': '#6B7280',
  'c-text-hint': '#9AA0AA',
  'c-text-faint': '#C3C8D0',
  'c-border': '#F0F1F4',
  // 阅读区
  'c-mark-bg': '#FBF3E4',
  'c-mark-line': '#E3B04B',
  'c-tag-bg': '#FBF3E4',
  'c-tag-text': '#B4690E',
  'c-sel-bg': '#2B6CB0',
  'c-sel-text': '#FFFFFF',
  'c-badge-border': '#A8A296',
  'c-danger': '#E24B4A',
  'c-danger-strong': '#A32D2D',
  // 划词操作栏
  'c-toolbar-bg': '#1F2430',
  'c-toolbar-text': '#FFFFFF',
  'c-toolbar-line': 'rgba(255,255,255,0.18)',
  // 底栏
  'c-tabbar-bg': '#FFFFFF',
  'c-tabbar-text': '#8A8F99',
  'c-tabbar-on': '#2B6CB0',
  // 导航栏
  'c-nav-bg': '#2B6CB0',
  'c-nav-text': 'white', // white | black（给 wx.setNavigationBarColor 用）
  // 阅读排版（用户可在「我的 → 阅读字体」里覆盖）
  'read-font': '34rpx',
  'read-line': '2.1',
  'read-indent': '34rpx',
  'read-para-gap': '16rpx',
  // 字体（由 utils/font.js 按当前字体包解析后覆盖，这里只是兜底串）
  'font-ui': "-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif",
  'font-read': "-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif",
  // 圆角
  'r-card': '20rpx',
  'r-btn': '16rpx',
  'r-sheet': '28rpx',
  'r-sm': '12rpx'
};

// 底栏四个 tab（图标 key 对应主题包里的图片文件名）
const TABS = [
  { pagePath: 'pages/quiz/quiz', text: '单词闯关', icon: 'tab.quiz' },
  { pagePath: 'pages/shelf/shelf', text: '书架', icon: 'tab.shelf' },
  { pagePath: 'pages/study/study', text: '学习', icon: 'tab.study' },
  { pagePath: 'pages/mine/mine', text: '我的', icon: 'tab.mine' }
];

// 底栏图标 / 封面：三套内置主题同构，key 见 TABS 的 icon 字段
const TAB_ICONS = {
  cover: 'cover.png',
  'tab.quiz': 'tab-quiz.png',
  'tab.quiz-on': 'tab-quiz-on.png',
  'tab.shelf': 'tab-shelf.png',
  'tab.shelf-on': 'tab-shelf-on.png',
  'tab.study': 'tab-study.png',
  'tab.study-on': 'tab-study-on.png',
  'tab.mine': 'tab-mine.png',
  'tab.mine-on': 'tab-mine-on.png'
};

// ---------- 内置主题包（新增主题：加一个对象 + 一个 themes/<id>/ 目录即可）----------
// font：主题推荐的字体包 id（见 utils/font.js）。用户手动选过字体后以用户设置为准。
const BUILT_IN = [
  {
    id: 'default',
    name: '经典蓝',
    desc: '当前默认样式，白底蓝调',
    dir: '/themes/default',
    font: 'system',
    tokens: {},
    images: Object.assign({}, TAB_ICONS)
  },
  {
    id: 'sepia',
    name: '羊皮纸',
    desc: '米黄纸纹 + 阅读衬线',
    dir: '/themes/sepia',
    font: 'literata',
    tokens: {
      'c-primary': '#8A6A3B',
      'c-primary-weak': '#F0E7D6',
      'c-primary-soft': '#F2E9D8',
      'c-primary-quote': '#F7F1E3',
      'c-bg': '#F5EFE1',
      'c-card': '#FBF7EE',
      'c-sunken': '#F3EBDC',
      'c-text': '#3A3226',
      'c-text-strong': '#2E2820',
      'c-text-sub': '#5C5241',
      'c-text-muted': '#7A6E5A',
      'c-text-hint': '#9C8F76',
      'c-text-faint': '#C4B79C',
      'c-border': '#E8DCC6',
      'c-mark-bg': '#EFE2C4',
      'c-mark-line': '#C9A227',
      'c-tag-bg': '#EFE2C4',
      'c-tag-text': '#8A6A3B',
      'c-sel-bg': '#8A6A3B',
      'c-badge-border': '#C4B79C',
      'c-toolbar-bg': '#3A3226',
      'c-tabbar-bg': '#FBF7EE',
      'c-tabbar-text': '#9C8F76',
      'c-tabbar-on': '#8A6A3B',
      'c-nav-bg': '#8A6A3B'
    },
    images: Object.assign({ bg: 'bg.png', 'bg-mode': 'repeat' }, TAB_ICONS)
  },
  {
    id: 'night',
    name: '夜间',
    desc: '深色底 + 屏幕优化无衬线',
    dir: '/themes/night',
    font: 'inter',
    tokens: {
      'c-primary': '#6FA8DC',
      'c-primary-weak': '#22303F',
      'c-primary-soft': '#22303F',
      'c-primary-quote': '#1E2833',
      'c-on-primary': '#0E1319',
      'c-bg': '#15181D',
      'c-card': '#1E222A',
      'c-sunken': '#22262F',
      'c-mask': 'rgba(0,0,0,0.6)',
      'c-text': '#E6E9EF',
      'c-text-strong': '#F2F4F8',
      'c-text-sub': '#B9C0CC',
      'c-text-muted': '#9AA3B0',
      'c-text-hint': '#7C8592',
      'c-text-faint': '#5A626E',
      'c-border': '#2C313A',
      'c-mark-bg': '#3A3524',
      'c-mark-line': '#B08A2E',
      'c-tag-bg': '#2C313A',
      'c-tag-text': '#E0B95C',
      'c-sel-bg': '#3C6382',
      'c-badge-border': '#5A626E',
      'c-danger': '#E86A69',
      'c-danger-strong': '#E88C8C',
      'c-toolbar-bg': '#2C313A',
      'c-tabbar-bg': '#1A1E25',
      'c-tabbar-text': '#7C8592',
      'c-tabbar-on': '#6FA8DC',
      'c-nav-bg': '#1A1E25'
    },
    images: Object.assign({}, TAB_ICONS)
  }
];

// ---------- 解析 ----------
const SANITIZE = (raw) => {
  const t = Object.assign({}, DEFAULT_TOKENS);
  Object.keys(raw || {}).forEach((k) => {
    if (raw[k] !== '' && raw[k] !== null && raw[k] !== undefined) t[k] = raw[k];
  });
  return t;
};

// 主题包里的图片 → 可直接给 <image src> 用的绝对路径
const asset = (theme, key) => {
  const f = (theme.images || {})[key];
  if (!f) return '';
  if (/^https?:\/\//.test(f) || f.indexOf('wxfile://') === 0 || f.charAt(0) === '/') return f;
  return (theme.dir || '') + '/' + f;
};

// 生效字体 id：用户设置（非 'theme'）优先，否则用主题推荐；字体包已删除时兜底系统字体
const pickFontId = (userVal, themeVal) => {
  const v = userVal && userVal !== 'theme' ? userVal : themeVal || 'system';
  return font.has(v) ? v : 'system';
};

// 把主题对象整理成运行时用的结构：vars / style / 图片绝对路径
const resolve = (def) => {
  const vars = SANITIZE(def.tokens);
  const images = def.images || {};
  const s = store.getSettings();

  // 字体：主题推荐 + 用户设置（用户显式选过就覆盖主题推荐）
  const readId = pickFontId(s.fontRead, def.font);
  const uiId = pickFontId(s.fontUi, 'system');
  vars['font-read'] = font.cssFamily(readId);
  vars['font-ui'] = font.cssFamily(uiId);

  // 阅读排版：0 / -1 是「跟随主题」哨兵值，其余是用户在设置里显式调过的
  const sz = Number(s.readFontSize);
  if (sz > 0) vars['read-font'] = sz + 'rpx';
  const lh = Number(s.readLineHeight);
  if (lh > 0) vars['read-line'] = String(lh);
  const ind = Number(s.readIndent);
  if (ind >= 0) vars['read-indent'] = ind + 'rpx';

  const theme = {
    id: def.id,
    name: def.name,
    desc: def.desc || '',
    dir: def.dir || '',
    font: def.font || 'system',
    fontReadId: readId,
    fontUiId: uiId,
    vars,
    images,
    style: buildStyle(vars),
    bgMode: images['bg-mode'] || 'repeat'
  };
  theme.cover = asset(theme, 'cover');
  theme.bgUrl = asset(theme, 'bg');
  return theme;
};

// vars → 页面根节点 style 字符串（CSS 变量注入点）
const buildStyle = (vars) =>
  Object.keys(vars)
    .filter((k) => k !== 'c-nav-text') // 导航栏文字色只在 JS 里用
    .map((k) => '--' + k + ':' + vars[k])
    .join(';');

// ---------- 主题列表 / 当前主题 ----------
const list = () => BUILT_IN.map(resolve);

const get = (id) => resolve(BUILT_IN.find((t) => t.id === id) || BUILT_IN[0]);

const currentId = () => {
  const id = store.getSettings().theme || 'default';
  return BUILT_IN.some((t) => t.id === id) ? id : 'default';
};

const current = () => get(currentId());

const use = (id) => {
  const s = store.getSettings();
  s.theme = BUILT_IN.some((t) => t.id === id) ? id : 'default';
  store.setSettings(s);
  return get(s.theme);
};

// ---------- 应用 ----------
// 导航栏只能运行时改；tabBar 由 custom-tab-bar 组件自己渲染
const applyNav = (t) => {
  const theme = t || current();
  wx.setNavigationBarColor({
    frontColor: theme.vars['c-nav-text'] === 'black' ? '#000000' : '#ffffff',
    backgroundColor: theme.vars['c-nav-bg'],
    fail: () => {}
  });
};

// 加载当前生效的字体文件：wx.loadFontFace 加载的字体冷启动后会失效，
// 所以每次启动、切主题、换字体都要重新 ensure 一次（font.js 内部做了并发去重与已加载缓存）
const applyFonts = () => {
  const t = current();
  return Promise.all([font.ensure(t.fontReadId), font.ensure(t.fontUiId)]);
};

// 每个页面 onShow 调一次：注入变量 + 背景图 + 同步底栏选中态
const bindPage = (page, tabIndex) => {
  const t = current();
  page.setData({
    themeStyle: t.style,
    themeBg: t.bgUrl,
    themeBgMode: t.bgMode,
    themePrimary: t.vars['c-primary']
  });
  applyNav(t);
  applyFonts();
  if (tabIndex >= 0 && typeof page.getTabBar === 'function') {
    const bar = page.getTabBar();
    if (bar) bar.sync(tabIndex, t);
  }
  return t;
};

// 底栏数据（图标、文字色、底栏背景）
const tabBarData = (t) => {
  const theme = t || current();
  return {
    list: TABS.map((x) => ({
      pagePath: x.pagePath,
      text: x.text,
      icon: asset(theme, x.icon),
      onIcon: asset(theme, x.icon + '-on')
    })),
    color: theme.vars['c-tabbar-text'],
    selectedColor: theme.vars['c-tabbar-on'],
    background: theme.vars['c-tabbar-bg'],
    bgImage: asset(theme, 'tabbar-bg'),
    style: theme.style
  };
};

module.exports = {
  TABS,
  DEFAULT_TOKENS,
  list, get, current, currentId, use,
  buildStyle, bindPage, applyNav, applyFonts, pickFontId, tabBarData, asset
};
