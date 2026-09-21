// utils/store.js —— 本地存储封装（个人版"数据库"）
// 一篇文章一个 key，避免超出单 key 1MB 限制

const KEYS = {
  INDEX: 'article_index',
  SETTINGS: 'settings',
  VOCAB: 'vocab',
  AI_CACHE: 'ai_cache',
  FONTS: 'font_packs',
  ARTICLE_PREFIX: 'article_',
  MARKS_PREFIX: 'marks_',
  NOTES_PREFIX: 'notes_',
  TTS_PREFIX: 'tts_'
};

const hash = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
};

const get = (k, d = null) => {
  try {
    const v = wx.getStorageSync(k);
    return v === '' || v === undefined || v === null ? d : v;
  } catch (e) {
    return d;
  }
};

// 存储满时先清理可再生的缓存（AI 缓存、TTS 缓存）再重试
const set = (k, v) => {
  try {
    wx.setStorageSync(k, v);
    return true;
  } catch (e) {
    evictCaches();
    try {
      wx.setStorageSync(k, v);
      return true;
    } catch (e2) {
      wx.showToast({ title: '本地存储已满，请导出备份后清理', icon: 'none' });
      return false;
    }
  }
};

const evictCaches = () => {
  try { wx.removeStorageSync(KEYS.AI_CACHE); } catch (e) {}
  try {
    wx.getStorageInfoSync().keys
      .filter((k) => k.indexOf(KEYS.TTS_PREFIX) === 0)
      .forEach((k) => wx.removeStorageSync(k));
  } catch (e) {}
};

const newId = () =>
  'a' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);

// ---------- 文章 ----------
const listArticles = () => get(KEYS.INDEX, []);

const SPLIT_VER = 2; // 分段版本：2 = 一句一段（遇到 "." 断段）

const saveArticle = (art) => {
  set(KEYS.ARTICLE_PREFIX + art.id, {
    id: art.id,
    title: art.title,
    paragraphs: art.paragraphs,
    sentences: art.sentences,
    splitVer: art.splitVer || SPLIT_VER
  });
  const idx = listArticles().filter((a) => a.id !== art.id);
  idx.unshift({ id: art.id, title: art.title, createdAt: art.createdAt, tokenCount: art.tokenCount });
  set(KEYS.INDEX, idx);
};

const getArticle = (id) => {
  const art = get(KEYS.ARTICLE_PREFIX + id, null);
  return normalizeArticle(art);
};

// 按句号重排段落：token id 保持不变（划线、笔记依然对得上）
const regroupBySentence = (paragraphs) => {
  const flat = [];
  paragraphs.forEach((p) => (p.tokens || []).forEach((t) => flat.push(t)));
  // 没有 sid 的老数据无法按句归组，保持原样
  if (!flat.length || flat.some((t) => t.sid === undefined || t.sid === null)) return null;
  const groups = [];
  flat.forEach((t) => {
    const last = groups[groups.length - 1];
    if (!last || last.sid !== t.sid) groups.push({ sid: t.sid, tokens: [t] });
    else last.tokens.push(t);
  });
  return groups.map((g, pid) => ({ pid, tokens: g.tokens }));
};

// 兼容旧版结构，并把历史文章一次性升级为「一句一段」
const normalizeArticle = (art) => {
  if (!art || !Array.isArray(art.paragraphs)) return art;
  if (art.paragraphs.length && Array.isArray(art.paragraphs[0])) {
    art.paragraphs = art.paragraphs.map((tokens, pid) => ({ pid, tokens }));
  }
  if (art.splitVer === SPLIT_VER) return art;
  const regrouped = regroupBySentence(art.paragraphs);
  if (regrouped) {
    art.paragraphs = regrouped;
    art.splitVer = SPLIT_VER;
    set(KEYS.ARTICLE_PREFIX + art.id, {
      id: art.id,
      title: art.title,
      paragraphs: art.paragraphs,
      sentences: art.sentences,
      splitVer: SPLIT_VER
    }); // 就地写回，只升级一次
  }
  return art;
};

const deleteArticle = (id) => {
  set(KEYS.INDEX, listArticles().filter((a) => a.id !== id));
  [KEYS.ARTICLE_PREFIX + id, KEYS.MARKS_PREFIX + id, KEYS.NOTES_PREFIX + id].forEach((k) => {
    try { wx.removeStorageSync(k); } catch (e) {}
  });
};

// ---------- 划线 / 笔记 ----------
const getMarks = (id) => get(KEYS.MARKS_PREFIX + id, []);
const addMark = (id, mark) => {
  const m = getMarks(id).filter((x) => !(x.start === mark.start && x.end === mark.end));
  m.push(mark);
  set(KEYS.MARKS_PREFIX + id, m);
  return m;
};
const removeMark = (id, mark) => {
  const m = getMarks(id).filter((x) => !(x.start === mark.start && x.end === mark.end));
  set(KEYS.MARKS_PREFIX + id, m);
  return m;
};

const getNotes = (id) => get(KEYS.NOTES_PREFIX + id, []);
const addNote = (id, note) => {
  const n = getNotes(id);
  n.unshift(note);
  set(KEYS.NOTES_PREFIX + id, n);
  return n;
};
const removeNote = (id, note) => {
  const n = getNotes(id).filter((x) => x.createdAt !== note.createdAt);
  set(KEYS.NOTES_PREFIX + id, n);
  return n;
};

// ---------- 生词本 ----------
const getVocab = () => get(KEYS.VOCAB, []);
const addVocab = (item) => {
  const v = getVocab().filter((x) => x.word !== item.word);
  v.unshift(item);
  set(KEYS.VOCAB, v);
  return v;
};
const deleteVocab = (word) => {
  const v = getVocab().filter((x) => x.word !== word);
  set(KEYS.VOCAB, v);
  return v;
};

// ---------- 设置 ----------
const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-9538dd9ebbab4f198d6a6289b97a5a39', // 仅个人本机使用
  model: 'deepseek-v4-flash',
  ttsApiKey: '', // 可选：硅基流动 Key，升级整句朗读音质；留空用免费接口
  autoPlay: false,
  theme: 'default', // 主题包 id（见 utils/theme.js 的 BUILT_IN）
  // 字体（字体包 id，见 utils/font.js；'theme' = 跟随主题推荐）
  fontRead: 'theme',
  fontUi: 'system',
  // 阅读排版：0 / -1 表示跟随主题默认值，用户手动调过后才写具体值
  readFontSize: 0,
  readLineHeight: 0,
  readIndent: -1
};
const getSettings = () => {
  const s = Object.assign({}, DEFAULT_SETTINGS, get(KEYS.SETTINGS, {}));
  // 清洗历史残留配置（旧智谱地址/模型/非 sk- 开头的 Key），统一回 DeepSeek 默认值
  if (s.baseUrl.indexOf('bigmodel') !== -1 || !s.baseUrl) s.baseUrl = DEFAULT_SETTINGS.baseUrl;
  if (s.model === 'glm-4-flash' || !s.model) s.model = DEFAULT_SETTINGS.model;
  if (!s.apiKey || s.apiKey.indexOf('sk-') !== 0) s.apiKey = DEFAULT_SETTINGS.apiKey;
  if (!s.ttsApiKey) s.ttsApiKey = DEFAULT_SETTINGS.ttsApiKey; // 旧设置残留空值时兜底
  if (!s.theme) s.theme = DEFAULT_SETTINGS.theme;
  if (!s.fontRead) s.fontRead = DEFAULT_SETTINGS.fontRead;
  if (!s.fontUi) s.fontUi = DEFAULT_SETTINGS.fontUi;
  // 排版数值合法性兜底（0 / -1 是「跟随主题」的哨兵值，原样保留）
  const clamp = (v, lo, hi, follow) => {
    const n = Number(v);
    if (!n && n !== 0) return follow;
    if (n === follow) return follow;
    return n < lo || n > hi ? follow : n;
  };
  s.readFontSize = clamp(s.readFontSize, 24, 56, 0);
  s.readLineHeight = clamp(s.readLineHeight, 1.3, 3.2, 0);
  s.readIndent = clamp(s.readIndent, 0, 90, -1);
  const sp = Number(s.ttsSpeed);
  s.ttsSpeed = !sp || sp < 0.5 || sp > 2 ? 1 : sp; // 语速合法性兜底
  return s;
};
const setSettings = (s) => set(KEYS.SETTINGS, s);

// ---------- AI 缓存 ----------
const getAICache = () => get(KEYS.AI_CACHE, {});
const putAICache = (key, result) => {
  const c = getAICache();
  c[key] = result;
  set(KEYS.AI_CACHE, c);
};
const clearAICache = () => { try { wx.removeStorageSync(KEYS.AI_CACHE); } catch (e) {} };

// ---------- 备份 / 恢复 ----------
const exportAll = () => {
  const data = { version: 1, exportedAt: new Date().toISOString(), data: {} };
  wx.getStorageInfoSync().keys.forEach((k) => {
    if (k.indexOf(KEYS.TTS_PREFIX) === 0) return; // TTS 缓存不备份
    data.data[k] = get(k);
  });
  return data;
};

const importAll = (backup) => {
  if (!backup || !backup.data) throw new Error('备份格式不正确');
  Object.keys(backup.data).forEach((k) => set(k, backup.data[k]));
  return Object.keys(backup.data).length;
};

module.exports = {
  KEYS, hash, get, set, evictCaches, newId,
  listArticles, saveArticle, getArticle, deleteArticle,
  getMarks, addMark, removeMark,
  getNotes, addNote, removeNote,
  getVocab, addVocab, deleteVocab,
  getSettings, setSettings,
  getAICache, putAICache, clearAICache,
  exportAll, importAll
};
