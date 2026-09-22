// utils/store.js —— 本地存储封装（个人版"数据库"）v3
// 数据模型：书籍(book) → 章节(chapter)，章节分 key 存储避免超出单 key 1MB 限制
// v3 起弃用旧的"单篇文章"模型，启动时清空旧文章数据（生词本/设置/主题/字体保留）

const KEYS = {
  DATA_VER: 'data_ver',
  BOOKS: 'book_index',        // [{id,title,author,hue,chapterCount,createdAt,lastReadAt,lastChapterId}]
  CHAPTER_PREFIX: 'chapter_', // chapter_<bookId>_<chapterId>
  SETTINGS: 'settings',
  VOCAB: 'vocab',
  AI_CACHE: 'ai_cache',
  FONTS: 'font_packs',
  SENTENCES: 'sentences',     // 收藏句子 [{id,text,translation,bookId,chapterId,bookTitle,chapterTitle,createdAt}]
  FAVORS: 'favors',           // 收藏章节 [{id,bookId,chapterId,title,bookTitle,createdAt}]
  STUDY: 'study_state',       // 学习 Agent 状态 + 对话记忆
  MARKS_PREFIX: 'marks_',     // marks_<chapterId>
  NOTES_PREFIX: 'notes_',     // notes_<chapterId>
  TTS_PREFIX: 'tts_'
};

const DATA_VER = 3;

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

// ---------- 版本迁移：v3 一次性清空旧文章模型 ----------
const migrate = () => {
  if (Number(get(KEYS.DATA_VER, 0)) >= DATA_VER) return;
  try {
    wx.getStorageInfoSync().keys.forEach((k) => {
      if (
        k.indexOf('article_') === 0 ||
        k.indexOf(KEYS.MARKS_PREFIX) === 0 ||
        k.indexOf(KEYS.NOTES_PREFIX) === 0
      ) {
        wx.removeStorageSync(k);
      }
    });
  } catch (e) {}
  set(KEYS.DATA_VER, DATA_VER);
};

// ---------- 书籍 ----------
const listBooks = () => get(KEYS.BOOKS, []);

const getBook = (id) => listBooks().find((b) => b.id === id) || null;

// 书籍记录里只存章节元信息，章节正文/分词/翻译单独存 key
const createBook = ({ title, author }) => {
  const book = {
    id: newId(),
    title: String(title || '').trim() || '未命名书籍',
    author: String(author || '').trim(),
    hue: Math.floor(Math.random() * 360), // 封面底色
    chapterCount: 0,
    createdAt: Date.now(),
    lastReadAt: 0,
    lastChapterId: ''
  };
  set(KEYS.BOOKS, [book].concat(listBooks()));
  return book;
};

const saveBook = (book) => {
  const list = listBooks().map((b) => (b.id === book.id ? book : b));
  set(KEYS.BOOKS, list);
  return book;
};

const touchBook = (bookId, chapterId) => {
  const b = getBook(bookId);
  if (!b) return;
  b.lastReadAt = Date.now();
  if (chapterId) b.lastChapterId = chapterId;
  saveBook(b);
};

const deleteBook = (bookId) => {
  const book = getBook(bookId);
  if (book && Array.isArray(book.chapters)) {
    book.chapters.forEach((c) => deleteChapterData(bookId, c.id));
  }
  set(KEYS.BOOKS, listBooks().filter((b) => b.id !== bookId));
};

// ---------- 章节 ----------
const chapterKey = (bookId, chapterId) => KEYS.CHAPTER_PREFIX + bookId + '_' + chapterId;

// 章节完整数据：{id, bookId, title, tokens:{paragraphs,sentences,tokenCount}, words:[{word,meaning}], translations:[sid]->string, translatedAt, quizDone, createdAt}
const getChapter = (bookId, chapterId) => get(chapterKey(bookId, chapterId), null);

const saveChapter = (bookId, ch) => {
  set(chapterKey(bookId, ch.id), ch);
  const b = getBook(bookId);
  if (!b) return;
  const chapters = Array.isArray(b.chapters) ? b.chapters.slice() : [];
  const meta = {
    id: ch.id,
    title: ch.title,
    wordCount: (ch.words || []).length,
    translated: !!ch.translatedAt,
    quizDone: !!ch.quizDone,
    createdAt: ch.createdAt
  };
  const idx = chapters.findIndex((c) => c.id === ch.id);
  if (idx >= 0) chapters[idx] = meta; else chapters.push(meta);
  b.chapters = chapters;
  b.chapterCount = chapters.length;
  saveBook(b);
};

// 只更新章节的部分字段（词表/翻译/闯关状态），避免整章重写
const patchChapter = (bookId, chapterId, patch) => {
  const ch = getChapter(bookId, chapterId);
  if (!ch) return null;
  Object.assign(ch, patch);
  saveChapter(bookId, ch);
  return ch;
};

const deleteChapterData = (bookId, chapterId) => {
  [chapterKey(bookId, chapterId), KEYS.MARKS_PREFIX + chapterId, KEYS.NOTES_PREFIX + chapterId].forEach((k) => {
    try { wx.removeStorageSync(k); } catch (e) {}
  });
};

const deleteChapter = (bookId, chapterId) => {
  const b = getBook(bookId);
  if (!b) return;
  b.chapters = (b.chapters || []).filter((c) => c.id !== chapterId);
  b.chapterCount = b.chapters.length;
  if (b.lastChapterId === chapterId) b.lastChapterId = '';
  saveBook(b);
  deleteChapterData(bookId, chapterId);
};

// 按书籍内顺序取章节 id 列表（书架/阅读器翻章用）
const chapterIds = (book) => ((book && book.chapters) || []).map((c) => c.id);

// ---------- 划线 / 笔记（按章节） ----------
const getMarks = (chapterId) => get(KEYS.MARKS_PREFIX + chapterId, []);
const addMark = (chapterId, mark) => {
  const m = getMarks(chapterId).filter((x) => !(x.start === mark.start && x.end === mark.end));
  m.push(mark);
  set(KEYS.MARKS_PREFIX + chapterId, m);
  return m;
};
const removeMark = (chapterId, mark) => {
  const m = getMarks(chapterId).filter((x) => !(x.start === mark.start && x.end === mark.end));
  set(KEYS.MARKS_PREFIX + chapterId, m);
  return m;
};

const getNotes = (chapterId) => get(KEYS.NOTES_PREFIX + chapterId, []);
const addNote = (chapterId, note) => {
  const n = getNotes(chapterId);
  n.unshift(note);
  set(KEYS.NOTES_PREFIX + chapterId, n);
  return n;
};
const removeNote = (chapterId, note) => {
  const n = getNotes(chapterId).filter((x) => x.createdAt !== note.createdAt);
  set(KEYS.NOTES_PREFIX + chapterId, n);
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
const setVocab = (v) => set(KEYS.VOCAB, v);
// 生词是否缺释义（闯关前批量补）
const vocabMissingMeaning = () => getVocab().filter((x) => !x.translation);

// ---------- 收藏句子 ----------
const listSentences = () => get(KEYS.SENTENCES, []);
const addSentence = (item) => {
  const s = listSentences();
  if (s.some((x) => x.text === item.text)) return s; // 去重
  s.unshift(Object.assign({ id: newId(), createdAt: Date.now() }, item));
  set(KEYS.SENTENCES, s);
  return s;
};
const removeSentence = (id) => {
  const s = listSentences().filter((x) => x.id !== id);
  set(KEYS.SENTENCES, s);
  return s;
};

// ---------- 收藏章节 ----------
const listFavors = () => get(KEYS.FAVORS, []);
const isFavored = (bookId, chapterId) =>
  listFavors().some((x) => x.bookId === bookId && x.chapterId === chapterId);
const toggleFavor = (item) => {
  let s = listFavors();
  const hit = s.find((x) => x.bookId === item.bookId && x.chapterId === item.chapterId);
  if (hit) {
    s = s.filter((x) => x !== hit);
  } else {
    s.unshift(Object.assign({ id: newId(), createdAt: Date.now() }, item));
  }
  set(KEYS.FAVORS, s);
  return !hit; // 返回切换后的状态
};

// ---------- 学习 Agent 状态 / 记忆 ----------
const DEFAULT_STUDY = {
  phase: 'idle', // idle → assess(摸底) → plan(已出计划) → reading(待闯关) → qa(已解锁问答)
  createdAt: 0,
  assess: null,  // {total, asked, history:[{title,answer,ok}]}
  plan: null,    // {text, chapters:[{bookId,chapterId,title,done}], createdAt}
  qa: null,      // {messages:[{role,content,ts}]}
  profile: ''    // AI 维护的学习者画像摘要（每轮注入）
};
const getStudy = () => Object.assign({}, DEFAULT_STUDY, get(KEYS.STUDY, {}));
const setStudy = (patch) => {
  const cur = getStudy();
  const next = Object.assign(cur, patch);
  set(KEYS.STUDY, next);
  return next;
};
const resetStudy = () => set(KEYS.STUDY, Object.assign({}, DEFAULT_STUDY));

// ---------- 设置 ----------
const DEFAULT_SETTINGS = {
  baseUrl: 'https://api.deepseek.com',
  apiKey: 'sk-9538dd9ebbab4f198d6a6289b97a5a39', // 仅个人本机使用
  model: 'deepseek-v4-flash',
  // 硅基流动：批量句译 / 词表提取等轻量任务
  sfApiKey: 'sk-lhtrhasgcxuwnmyvcippzjyldspvmxhfjjjhhgtxfkqxvgoq',
  sfBaseUrl: 'https://api.siliconflow.cn',
  sfModel: 'Qwen/Qwen2.5-7B-Instruct',
  ttsApiKey: '', // 可选：硅基流动 Key，升级整句朗读音质；留空用免费接口
  autoPlay: false,
  theme: 'default',
  fontRead: 'theme',
  fontUi: 'system',
  readFontSize: 0,
  readLineHeight: 0,
  readIndent: -1,
  showTrans: false,   // 阅读页显示句译
  quizCount: 30,      // 单词闯关每次取生词本最近 N 个
  localFallback: false // 本地兜底：网络不通时用内置离线词库/预缓存句译顶上（调试 API 时可关掉，暴露真实网络结果）
};
const getSettings = () => {
  const s = Object.assign({}, DEFAULT_SETTINGS, get(KEYS.SETTINGS, {}));
  if (s.baseUrl.indexOf('bigmodel') !== -1 || !s.baseUrl) s.baseUrl = DEFAULT_SETTINGS.baseUrl;
  if (s.model === 'glm-4-flash' || !s.model) s.model = DEFAULT_SETTINGS.model;
  if (!s.apiKey || s.apiKey.indexOf('sk-') !== 0) s.apiKey = DEFAULT_SETTINGS.apiKey;
  if (!s.sfApiKey || s.sfApiKey.indexOf('sk-') !== 0) s.sfApiKey = DEFAULT_SETTINGS.sfApiKey;
  if (!s.sfBaseUrl) s.sfBaseUrl = DEFAULT_SETTINGS.sfBaseUrl;
  if (!s.sfModel) s.sfModel = DEFAULT_SETTINGS.sfModel;
  if (!s.ttsApiKey) s.ttsApiKey = DEFAULT_SETTINGS.ttsApiKey;
  if (!s.theme) s.theme = DEFAULT_SETTINGS.theme;
  if (!s.fontRead) s.fontRead = DEFAULT_SETTINGS.fontRead;
  if (!s.fontUi) s.fontUi = DEFAULT_SETTINGS.fontUi;
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
  s.ttsSpeed = !sp || sp < 0.5 || sp > 2 ? 1 : sp;
  const qc = Number(s.quizCount);
  s.quizCount = !qc || qc < 5 || qc > 100 ? 30 : qc;
  s.showTrans = !!s.showTrans;
  s.localFallback = !!s.localFallback;
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

// ---------- 内置书种子（四级/考研分级阅读） ----------
// seed-data.js 体积较大，惰性 require：仅首次注入时加载
// SEED_VER 已达标则跳过（用户删除内置书后不会复活）
const seedBuiltIns = () => {
  const SEED_KEY = 'seed_ver';
  const WORDS_KEY = 'words_ver';
  const seed = require('./seed-data');
  const wantWords = Number(get(WORDS_KEY, 0)) < Number(seed.WORDS_VER || 0);
  if (Number(get(SEED_KEY, 0)) >= seed.SEED_VER && !wantWords) return;
  const { tokenizeArticle } = require('./tokenize');
  const toWords = (sc) => (sc.words || []).map((w) => ({ word: w[0], meaning: w[1] }));
  seed.books.forEach((sb) => {
    const expected = sb.chapters.length;
    const existing = getBook(sb.id);
    if (existing && existing.chapterCount === expected) {
      // 书已完整：只在新旧词表版本不一致时补刷词表，保留阅读进度/闯关记录/划线
      if (wantWords) {
        sb.chapters.forEach((sc) => {
          if (!getChapter(sb.id, sc.id)) return;
          patchChapter(sb.id, sc.id, { words: toWords(sc) });
        });
      }
      return;
    }
    if (existing) {
      // 章节数不齐（旧版本注入 bug 残留）→ 整本重建（内置书可再生，安全）
      deleteBook(sb.id);
    }
    const book = {
      id: sb.id,
      title: sb.title,
      author: sb.author,
      hue: sb.hue,
      chapterCount: 0,
      createdAt: Date.now(),
      lastReadAt: 0,
      lastChapterId: '',
      chapters: []
    };
    // 先注册书籍再逐章保存，saveChapter 才能把章节元信息挂到 book.chapters
    set(KEYS.BOOKS, [book].concat(listBooks()));
    sb.chapters.forEach((sc) => {
      const t = tokenizeArticle(sc.title, sc.text);
      if (!t.paragraphs.length) return;
      // 翻译数组与分句结果按 sid 严格对齐（长度兜底）
      const translations = t.sentences.map((_, i) => (sc.translations || [])[i] || '');
      const ch = {
        id: sc.id,
        bookId: sb.id,
        title: sc.title,
        rawText: sc.text,
        tokens: { paragraphs: t.paragraphs, sentences: t.sentences, tokenCount: t.tokenCount },
        words: toWords(sc),
        translations,
        translatedAt: translations.some(Boolean) ? Date.now() : 0,
        quizDone: false,
        createdAt: Date.now()
      };
      saveChapter(sb.id, ch);
    });
  });
  set(SEED_KEY, seed.SEED_VER);
  if (wantWords) set(WORDS_KEY, seed.WORDS_VER);
};

// ---------- 备份 / 恢复 ----------
const exportAll = () => {
  const data = { version: DATA_VER, exportedAt: new Date().toISOString(), data: {} };
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
  KEYS, DATA_VER, hash, get, set, evictCaches, newId, migrate, seedBuiltIns,
  listBooks, getBook, createBook, saveBook, touchBook, deleteBook,
  getChapter, saveChapter, patchChapter, deleteChapter, chapterIds,
  getMarks, addMark, removeMark,
  getNotes, addNote, removeNote,
  getVocab, addVocab, deleteVocab, setVocab, vocabMissingMeaning,
  listSentences, addSentence, removeSentence,
  listFavors, isFavored, toggleFavor,
  getStudy, setStudy, resetStudy,
  getSettings, setSettings,
  getAICache, putAICache, clearAICache,
  exportAll, importAll
};
