import seed from "../data/seed";
import { tokenize } from "../core/text";
import { Book, Chapter } from "../core/models";
import * as storage from "./storage";

export function seedLibrary(): void {
  const fresh = storage.read("seed_ver", 0) < seed.SEED_VER;
  const updateWords = storage.read("words_ver", 0) < seed.WORDS_VER;
  if (!fresh && !updateWords) return;
  const list = storage.books();
  const values: Record<string, unknown> = {};
  for (const source of seed.books) {
    let owner = list.find((b) => b.id === source.id);
    if (!owner && !fresh) continue;
    if (!owner) {
      owner = {
        id: source.id,
        title: source.title,
        author: source.author,
        hue: source.hue,
        chapters: [],
        chapterCount: 0,
        createdAt: Date.now(),
        lastReadAt: 0,
        lastChapterId: "",
      };
      list.push(owner);
    }
    for (const content of source.chapters) {
      const old = storage.chapter(owner.id, content.id);
      if (old && !updateWords) continue;
      if (!old && !fresh) continue;
      const value: Chapter = old
        ? {
            ...old,
            words: content.words.map((w) => ({ word: w[0], meaning: w[1] })),
          }
        : {
            id: content.id,
            bookId: owner.id,
            title: content.title,
            rawText: content.text,
            tokens: tokenize(content.text),
            words: content.words.map((w) => ({ word: w[0], meaning: w[1] })),
            translations: content.translations,
            translatedAt: Date.now(),
            quizDone: false,
            createdAt: Date.now(),
          };
      values[storage.chapterKey(owner.id, content.id)] = value;
      const meta = {
        id: value.id,
        title: value.title,
        wordCount: value.words.length,
        translated: value.translations.some(Boolean),
        quizDone: value.quizDone,
        createdAt: value.createdAt,
      };
      const i = owner.chapters.findIndex((c) => c.id === meta.id);
      if (i < 0) owner.chapters.push(meta);
      else owner.chapters[i] = meta;
    }
    owner.chapterCount = owner.chapters.length;
  }
  storage.transaction({
    ...values,
    book_index: list,
    seed_ver: seed.SEED_VER,
    words_ver: seed.WORDS_VER,
    data_ver: 3,
  });
}
export function clearUserData(includeSettings: boolean): void {
  const kept: Book[] = storage
    .books()
    .filter((b) => seed.books.some((s) => s.id === b.id))
    .map((b) => ({
      ...b,
      lastReadAt: 0,
      lastChapterId: "",
      chapters: b.chapters.map((c) => ({ ...c, quizDone: false })),
    }));
  const values: Record<string, unknown> = {
    book_index: kept,
    data_ver: 3,
    seed_ver: kept.length === seed.books.length ? seed.SEED_VER : 0,
    words_ver: seed.WORDS_VER,
  };
  if (!includeSettings) {
    const s = storage.settings();
    values.settings = {
      ...s,
      fontRead:
        s.fontRead.startsWith("f") && s.fontRead !== "theme"
          ? "system"
          : s.fontRead,
      fontUi: s.fontUi.startsWith("f") ? "system" : s.fontUi,
    };
  }
  kept.forEach((b) =>
    b.chapters.forEach((c) => {
      const value = storage.chapter(b.id, c.id);
      if (value)
        values[storage.chapterKey(b.id, c.id)] = { ...value, quizDone: false };
    }),
  );
  storage.transaction(
    values,
    wx.getStorageInfoSync().keys.filter((k) => !(k in values)),
  );
  storage.clearCache();
  seedLibrary();
}
