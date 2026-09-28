import * as learningRepository from "./learning-repository";
import { recoverTransaction } from "./local-storage";
import {
  Book,
  Chapter,
  ChapterMeta,
  Favorite,
  Mark,
  Note,
  Sentence,
  Settings,
  Vocab,
  id,
  record,
} from "../core/models";
import {
  validateLearningBackup,
  discardLegacySessions,
} from "../core/learning";

import { read, write, transaction } from "./local-storage";
export { read, write, transaction, clearCache } from "./local-storage";
export const defaults: Settings = {
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  model: "deepseek-v4-flash",
  apiKey: "",
  sfBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  sfModel: "qwen-flash",
  sfApiKey: "",
  ttsApiKey: "",
  ttsSpeed: 1,
  autoPlay: false,
  theme: "default",
  fontRead: "theme",
  fontUi: "system",
  readFontSize: 0,
  readLineHeight: 0,
  readIndent: -1,
  showTrans: false,
  quizCount: 30,
  localFallback: true,
};
export function settings(): Settings {
  const value = { ...defaults, ...read<Partial<Settings>>("settings", {}) };
  for (const key of [
    "baseUrl",
    "model",
    "apiKey",
    "sfBaseUrl",
    "sfModel",
    "sfApiKey",
    "ttsApiKey",
    "theme",
    "fontRead",
    "fontUi",
  ] as const)
    if (typeof value[key] !== "string") value[key] = defaults[key];
  for (const key of ["fontRead", "fontUi"] as const)
    if (value[key] === "garamond" || value[key] === "inter")
      value[key] = "literata";
  for (const [key, min, max, fallback] of [
    ["ttsSpeed", 0.5, 2, 1],
    ["quizCount", 5, 100, 30],
    ["readFontSize", 24, 56, 0],
    ["readLineHeight", 1.3, 3.2, 0],
    ["readIndent", 0, 90, -1],
  ] as const) {
    const n = Number(value[key]);
    value[key] = Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  }
  // Never send a credential from the retired provider to Bailian.
  const bailianKey = value.baseUrl.replace(/\/+$/, "") === defaults.baseUrl
    ? value.apiKey.trim() : "";
  Object.assign(value, {
    baseUrl: defaults.baseUrl, model: defaults.model,
    sfBaseUrl: defaults.sfBaseUrl, sfModel: defaults.sfModel,
    apiKey: bailianKey, sfApiKey: bailianKey, ttsApiKey: bailianKey,
  });
  value.quizCount = Math.round(value.quizCount);
  return value;
}
export function saveSettings(patch: Partial<Settings>): void {
  const value = { ...settings(), ...patch };
  const key = value.apiKey.trim();
  write("settings", { ...value,
    baseUrl: defaults.baseUrl, model: defaults.model,
    sfBaseUrl: defaults.sfBaseUrl, sfModel: defaults.sfModel,
    apiKey: key, sfApiKey: key, ttsApiKey: key,
  });
}
export function books(): Book[] {
  return read<Book[]>("book_index", []).map((b) => ({
    ...b,
    chapters: b.chapters || [],
    chapterCount: (b.chapters || []).length,
  }));
}
export const book = (bookId: string): Book | null =>
  books().find((b) => b.id === bookId) || null;
export const chapterKey = (bookId: string, chapterId: string): string =>
  `chapter_${bookId}_${chapterId}`;
export const chapter = (bookId: string, chapterId: string): Chapter | null =>
  read<Chapter | null>(chapterKey(bookId, chapterId), null);
export function createBook(title: string): Book {
  if (!title.trim()) throw new Error("请输入书名");
  const result: Book = {
    id: id(),
    title: title.trim(),
    author: "",
    hue: Math.floor(Math.random() * 360),
    chapters: [],
    chapterCount: 0,
    createdAt: Date.now(),
    lastReadAt: 0,
    lastChapterId: "",
  };
  write("book_index", [result, ...books()]);
  return result;
}
export function saveChapter(value: Chapter, resetAnnotations = false): void {
  const list = books();
  const owner = list.find((b) => b.id === value.bookId);
  if (!owner) throw new Error("书籍已不存在");
  const meta: ChapterMeta = {
    kind: value.kind || "article",
    questionCount:
      value.sections?.reduce((n, s) => n + s.questions.length, 0) || 0,
    id: value.id,
    title: value.title,
    wordCount: value.words.length,
    translated: value.translations.some(Boolean),
    quizDone: value.quizDone,
    createdAt: value.createdAt,
  };
  const index = owner.chapters.findIndex((c) => c.id === value.id);
  if (index < 0) owner.chapters.push(meta);
  else owner.chapters[index] = meta;
  owner.chapterCount = owner.chapters.length;
  transaction(
    { [chapterKey(value.bookId, value.id)]: value, book_index: list },
    resetAnnotations ? ["marks_" + value.id] : [],
  );
}
export function touchBook(bookId: string, chapterId: string): void {
  const list = books();
  const owner = list.find((b) => b.id === bookId);
  if (owner) {
    owner.lastChapterId = chapterId;
    owner.lastReadAt = Date.now();
    write("book_index", list);
  }
}
function removeContent(
  bookId: string,
  chapterIds: string[],
  removeBook: boolean,
): void {
  const list = books();
  const owner = list.find((b) => b.id === bookId);
  if (!owner) return;
  owner.chapters = owner.chapters.filter((c) => !chapterIds.includes(c.id));
  owner.chapterCount = owner.chapters.length;
  if (chapterIds.includes(owner.lastChapterId)) owner.lastChapterId = "";
  transaction(
    {
      book_index: removeBook ? list.filter((b) => b.id !== bookId) : list,
      favors: favorites().filter(
        (f) => f.bookId !== bookId || !chapterIds.includes(f.chapterId),
      ),
    },
    chapterIds.flatMap((c) => [
      chapterKey(bookId, c),
      "marks_" + c,
      "notes_" + c,
    ]),
  );
}
export function deleteBook(bookId: string): void {
  if (bookId === "ai_learning")
    throw new Error("AI 学习书籍关联课程记录，不能单独删除");
  removeContent(bookId, book(bookId)?.chapters.map((c) => c.id) || [], true);
}
export function deleteChapter(bookId: string, chapterId: string): void {
  if (bookId === "ai_learning")
    throw new Error("AI 章节关联课程记录，不能单独删除");
  removeContent(bookId, [chapterId], false);
}
export const marks = (chapterId: string): Mark[] =>
  read("marks_" + chapterId, []);
export const notes = (chapterId: string): Note[] =>
  read("notes_" + chapterId, []);
export const vocab = (): Vocab[] => read("vocab", []);
export function addVocab(item: Vocab): void {
  write("vocab", [
    item,
    ...vocab().filter((v) => v.word.toLowerCase() !== item.word.toLowerCase()),
  ]);
}
export const sentences = (): Sentence[] => read("sentences", []);
export function addSentence(item: Omit<Sentence, "id" | "createdAt">): void {
  if (!sentences().some((s) => s.text === item.text))
    write("sentences", [
      { ...item, id: id(), createdAt: Date.now() },
      ...sentences(),
    ]);
}
export const favorites = (): Favorite[] => read("favors", []);
export const isFavorite = (b: string, c: string): boolean =>
  favorites().some((f) => f.bookId === b && f.chapterId === c);
export function toggleFavorite(
  item: Omit<Favorite, "id" | "createdAt">,
): boolean {
  const active = isFavorite(item.bookId, item.chapterId);
  write(
    "favors",
    active
      ? favorites().filter(
          (f) => f.bookId !== item.bookId || f.chapterId !== item.chapterId,
        )
      : [{ ...item, id: id(), createdAt: Date.now() }, ...favorites()],
  );
  return !active;
}
export function completeChapter(bookId: string, chapterId: string): void {
  const value = chapter(bookId, chapterId);
  if (!value) throw new Error("章节已不存在");
  const list = books();
  const owner = list.find((b) => b.id === bookId);
  const meta = owner?.chapters.find((c) => c.id === chapterId);
  if (meta) meta.quizDone = true;
  transaction({
    [chapterKey(bookId, chapterId)]: { ...value, quizDone: true },
    book_index: list,
  });
}
export function exportBackup(): {
  version: number;
  exportedAt: string;
  data: Record<string, unknown>;
} {
  recoverTransaction();
  const learning = read("learning_v1", null) || read(learningRepository.INDEX, null) ? learningRepository.load() : null;
  const data: Record<string, unknown> = {};
  wx.getStorageInfoSync()
    .keys.filter((k) => k !== "study_state" && k !== "storage_transaction_pending" && !k.startsWith("learning_v2_") && !/^tts_/.test(k))
    .forEach((k) => {
      data[k] = wx.getStorageSync(k);
    });
  if (learning) data.learning_v1 = learning;
  if (data.learning_v1)
    data.learning_v1 = discardLegacySessions(
      data.learning_v1 as import("../core/learning").Learning,
    );
  return { version: 4, exportedAt: new Date().toISOString(), data };
}
export function importBackup(input: unknown): number {
  const backup = record(input);
  const data = { ...record(backup.data) };
  delete data.study_state;
  delete data.storage_transaction_pending;
  for (const key of Object.keys(data)) if (key.startsWith("learning_v2_")) delete data[key];
  if (data.learning_v1)
    data.learning_v1 = discardLegacySessions(
      data.learning_v1 as import("../core/learning").Learning,
    );
  if (!Object.keys(data).length) throw new Error("备份内容为空或格式不正确");
  if (Number(backup.version) > 4)
    throw new Error("此备份来自更新版本，请先升级应用");
  for (const key of Object.keys(data))
    if (["__proto__", "prototype", "constructor"].includes(key))
      throw new Error("备份包含无效字段");
  for (const key of [
    "book_index",
    "vocab",
    "sentences",
    "favors",
    "font_packs",
  ])
    if (key in data && !Array.isArray(data[key]))
      throw new Error("备份字段格式错误：" + key);
  if (Array.isArray(data.book_index))
    for (const raw of data.book_index) {
      const b = record(raw);
      if (
        typeof b.id !== "string" ||
        typeof b.title !== "string" ||
        !Array.isArray(b.chapters)
      )
        throw new Error("书籍记录不完整");
      for (const rawChapter of b.chapters) {
        const c = record(rawChapter);
        const value = record(data[chapterKey(b.id, String(c.id))]);
        if (
          typeof c.id !== "string" ||
          typeof value.rawText !== "string" ||
          !Array.isArray(record(value.tokens).paragraphs) ||
          !Array.isArray(value.words) ||
          !Array.isArray(value.translations)
        )
          throw new Error("备份缺少完整章节：" + String(c.title || c.id));
      }
    }
  if ("learning_v1" in data) validateLearningBackup(data.learning_v1, data);
  transaction(
    data,
    [...wx.getStorageInfoSync().keys.filter(k => k.startsWith("learning_v2_")), ...("learning_v1" in data ? ["study_state"] : ["study_state", "learning_v1"])],
  );
  return Object.keys(data).length;
}
