// utils/font.js —— 字体包内核
//
// 微信平台的字体限制决定了实现方式：
// 1. 字体只能运行时用 wx.loadFontFace 加载，**冷启动后会失效** → 每次启动都要重新加载（app.onLaunch 走 bootstrap）。
// 2. loadFontFace 读不了小程序包内路径 → 内置字体要先 copyFile 到 USER_DATA_PATH，再用 wxfile:// 路径加载。
// 3. 要全局生效必须传 global: true（否则只对下一个页面生效）；Skyline 渲染还需 scopes 带上 'native'。
// 4. 注册的 family 必须唯一稳定，否则会和系统字体撞名用错字形 → 自备字体统一用 EngCustom-<id> 前缀。
// 5. 中文大字体（几 MB）不适合打进包（主包 2MB 限制），所以内置只放英文子集，
//    中文靠 CSS 字体列表里的系统字体兜底；想用中文字体（如霞鹜文楷）走「导入字体包」，文件存在用户目录，不占包体。

const store = require('./store');

const PACK_DIR = 'fonts';           // 用户目录下的字体包目录
const CUSTOM_PREFIX = 'EngCustom-'; // 自备字体的注册名前缀（保证不与系统字体撞名）
const MAX_SIZE = 20 * 1024 * 1024;  // 单个字体文件上限

// ---------- 系统字体（0 体积，随系统可用）----------
const SYSTEM = [
  {
    id: 'system', kind: 'system', name: '系统默认', alias: '默认',
    desc: '跟随系统，中英混排最协调',
    family: "-apple-system, 'PingFang SC', 'Helvetica Neue', 'Microsoft YaHei', sans-serif",
    sample: 'Reading 精读 Aa'
  },
  {
    id: 'serif-sys', kind: 'system', name: '系统衬线', alias: '衬线',
    desc: '系统自带衬线体，无需加载',
    family: "Georgia, 'Times New Roman', 'Songti SC', 'Noto Serif', serif",
    sample: 'Reading 精读 Aa'
  },
  {
    id: 'mono-sys', kind: 'system', name: '系统等宽', alias: '等宽',
    desc: '等宽字体，适合逐词比对',
    family: "Menlo, Consolas, 'Courier New', monospace",
    sample: 'Reading 精读 Aa'
  }
];

// ---------- 内置字体包 ----------
// 与 fonts/<id>/manifest.json 同构；这里是运行时唯一数据源（manifest 供自备字体包参照与导出规范）
const BUILT_IN = [
  {
    id: 'literata', kind: 'builtin',
    name: 'Literata', alias: '阅读衬线',
    desc: 'Google 为长文阅读设计',
    family: 'EngReader Literata',
    fallback: "Georgia, 'Times New Roman', 'Songti SC', serif",
    file: 'literata.ttf', boldFile: 'literata-bold.ttf',
    sample: 'Reading 精读 Aa'
  },
  {
    id: 'garamond', kind: 'builtin',
    name: 'EB Garamond', alias: '古典衬线',
    desc: '文艺复兴老式衬线，典雅',
    family: 'EngReader Garamond',
    fallback: "Georgia, 'Times New Roman', 'Songti SC', serif",
    file: 'garamond.ttf', boldFile: 'garamond-bold.ttf',
    sample: 'Reading 精读 Aa'
  },
  {
    id: 'inter', kind: 'builtin',
    name: 'Inter', alias: '现代无衬线',
    desc: '屏幕优化的无衬线体',
    family: 'EngReader Inter',
    fallback: "-apple-system, 'PingFang SC', sans-serif",
    file: 'inter.ttf', boldFile: 'inter-bold.ttf',
    sample: 'Reading 精读 Aa'
  }
];

// ---------- 文件系统小工具 ----------
const fsm = () => wx.getFileSystemManager();
const abs = (rel) => wx.env.USER_DATA_PATH + '/' + rel;

const exists = (p) => {
  try { fsm().accessSync(p); return true; } catch (e) { return false; }
};

const sizeOf = (p) => {
  try { return fsm().statSync(p).size || 0; } catch (e) { return 0; }
};

const ensureDir = (p) => {
  if (exists(p)) return;
  try { fsm().mkdirSync(p, true); } catch (e) {}
};

const rmQuiet = (p) => {
  try { fsm().unlinkSync(p); } catch (e) {}
};

const fmtSize = (bytes) => {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
};

// ---------- 自备字体包（索引存在本地存储，文件存在用户目录）----------
const listCustom = () => store.get(store.KEYS.FONTS, []) || [];

const customDef = (c) => ({
  id: c.id,
  kind: 'custom',
  name: c.name,
  alias: '自备',
  desc: '已导入 · ' + fmtSize(c.size),
  family: c.family,
  fallback: "-apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif",
  path: abs(c.rel),
  size: c.size,
  createdAt: c.createdAt,
  sample: c.sample || 'Reading 精读 Aa'
});

// ---------- 字体查找 ----------
const allDefs = () => SYSTEM.concat(BUILT_IN, listCustom().map(customDef));

const find = (id) => allDefs().find((x) => x.id === id) || null;

const has = (id) => !!find(id);

// ---------- 设置页用列表 ----------
const list = () => allDefs().map((x) => ({
  id: x.id,
  kind: x.kind,
  name: x.name,
  alias: x.alias,
  desc: x.desc,
  sample: x.sample,
  size: x.size || 0,
  sizeText: x.size ? fmtSize(x.size) : (x.kind === 'builtin' ? '内置' : '')
}));

// ---------- CSS font-family 串 ----------
const cssFamily = (id) => {
  const def = find(id);
  if (!def) return SYSTEM[0].family;
  if (def.kind === 'system') return def.family;
  return "'" + def.family + "', " + (def.fallback || "-apple-system, sans-serif");
};

// ---------- 加载 ----------
const loaded = {};   // 'family|weight' → true（本次会话已加载）
const pending = {};  // id → Promise（并发去重）

const loadFace = (family, src, weight, style) => new Promise((resolve) => {
  const key = family + '|' + weight;
  if (loaded[key]) return resolve(true);
  wx.loadFontFace({
    family,
    source: 'url("' + src + '")',
    desc: { style: style || 'normal', weight: weight || '400', variant: 'normal' },
    global: true,                    // 不传 global 只对下一个页面生效
    scopes: ['webview', 'native'],   // Skyline 渲染下也要生效
    success: () => {
      loaded[key] = true;
      resolve(true);
    },
    fail: (err) => {
      console.warn('[font] 加载失败', family, weight, (err && err.errMsg) || '');
      resolve(false);
    }
  });
});

// 内置字体：包内 → 用户目录（缓存复用，只在首次或换包时复制）
const ensureBuiltinFile = (pack, bold) => {
  const rel = PACK_DIR + '/builtin-' + pack.id + (bold ? '-bold' : '') + '.ttf';
  const dest = abs(rel);
  if (exists(dest) && sizeOf(dest) > 0) return dest;
  ensureDir(abs(PACK_DIR));
  fsm().copyFileSync('/fonts/' + pack.id + '/' + (bold ? pack.boldFile : pack.file), dest);
  return dest;
};

const loadBuiltin = (def) => {
  let jobs;
  try {
    jobs = [loadFace(def.family, ensureBuiltinFile(def, false), '400', 'normal')];
    if (def.boldFile) jobs.push(loadFace(def.family, ensureBuiltinFile(def, true), '700', 'normal'));
  } catch (e) {
    console.warn('[font] 内置字体复制失败', def.id, e && e.message);
    return Promise.resolve(false);
  }
  return Promise.all(jobs).then((r) => r.some(Boolean));
};

const loadCustom = (def) => {
  if (!def.path || !exists(def.path)) return Promise.resolve(false);
  return loadFace(def.family, def.path, '400', 'normal');
};

/**
 * 确保某个字体可用（启动、切主题、预览时调用）
 * @returns Promise<{ok, def}> —— ok=false 时样式会退到 fallback 字体，不会白屏
 */
const ensure = (id) => {
  const key = id || 'system';
  if (pending[key]) return pending[key];
  const def = find(key);
  if (!def || def.kind === 'system') return Promise.resolve({ ok: true, def: def || SYSTEM[0] });
  const p = (def.kind === 'builtin' ? loadBuiltin(def) : loadCustom(def))
    .then((ok) => ({ ok, def }))
    .catch(() => ({ ok: false, def }));
  pending[key] = p;
  return p;
};

// 设置页预览：把所有字体都加载一遍（只有内置/自备需要真正加载）
const preloadAll = () => Promise.all(allDefs().map((x) => ensure(x.id)));

// ---------- 安装 / 卸载 ----------
const EXT_OK = ['.ttf', '.otf', '.woff'];

const installFile = (file) => new Promise((resolve, reject) => {
  if (!file || !file.path) return reject(new Error('没有取到字体文件'));
  const rawName = String(file.name || 'font.ttf');
  const m = rawName.match(/\.[a-z0-9]+$/i);
  const ext = (m ? m[0] : '.ttf').toLowerCase();
  if (EXT_OK.indexOf(ext) < 0) return reject(new Error('只支持 ttf / otf / woff 字体文件'));

  const size = file.size || sizeOf(file.path);
  if (size > MAX_SIZE) return reject(new Error('字体文件过大（上限 20MB）'));

  const id = 'f' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
  const family = CUSTOM_PREFIX + id;
  const rel = PACK_DIR + '/' + id + ext;

  try {
    ensureDir(abs(PACK_DIR));
    fsm().copyFileSync(file.path, abs(rel)); // 临时文件 → 用户目录，永久保存
  } catch (e) {
    return reject(new Error('字体文件保存失败：' + ((e && e.message) || '')));
  }

  loadFace(family, abs(rel), '400', 'normal').then((ok) => {
    if (!ok) {
      rmQuiet(abs(rel)); // 加载不成功就回滚，避免装进一个用不了的字体
      return reject(new Error('字体加载失败，请确认是有效的字体文件'));
    }
    const rec = {
      id, family,
      name: rawName.replace(/\.[a-z0-9]+$/i, ''),
      rel, size,
      createdAt: Date.now()
    };
    const c = listCustom();
    c.push(rec);
    store.set(store.KEYS.FONTS, c);
    resolve(rec);
  });
});

// 从聊天记录选字体文件安装
const pickAndInstall = () => new Promise((resolve, reject) => {
  wx.chooseMessageFile({
    count: 1,
    type: 'file',
    extension: EXT_OK,
    success: (res) => {
      const f = res.tempFiles && res.tempFiles[0];
      installFile(f).then(resolve).catch(reject);
    },
    fail: (e) => reject(e) // 用户取消
  });
});

const uninstall = (id) => {
  const c = listCustom();
  const rec = c.find((x) => x.id === id);
  if (!rec) return false;
  rmQuiet(abs(rec.rel));
  store.set(store.KEYS.FONTS, c.filter((x) => x.id !== id));
  // 正在使用的字体被删掉 → 回退系统默认，避免页面引用到不存在的字体
  const s = store.getSettings();
  let changed = false;
  if (s.fontRead === id) { s.fontRead = 'system'; changed = true; }
  if (s.fontUi === id) { s.fontUi = 'system'; changed = true; }
  if (changed) store.setSettings(s);
  return true;
};

// 清理用户目录里的字体残留：
// 1) 索引存在但文件没了（例如导入备份时只带了索引）→ 删掉索引记录
// 2) 文件在但索引没了 → 删掉文件
const gc = () => {
  const c = listCustom();
  const alive = c.filter((x) => exists(abs(x.rel)));
  if (alive.length !== c.length) store.set(store.KEYS.FONTS, alive);
  try {
    const keep = alive.map((x) => x.rel);
    fsm().readdirSync(abs(PACK_DIR)).forEach((name) => {
      const rel = PACK_DIR + '/' + name;
      if (name.indexOf('builtin-') === 0) return; // 内置字体缓存按需重建，保留
      if (keep.indexOf(rel) < 0) rmQuiet(abs(rel));
    });
  } catch (e) {}
};

module.exports = {
  SYSTEM,
  BUILT_IN,
  PACK_DIR,
  list, listCustom, find, has, cssFamily, ensure, preloadAll,
  pickAndInstall, installFile, uninstall, gc,
  fmtSize
};
