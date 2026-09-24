import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { tokenize, splitSentences, joinTokens } from "../core/text";
import { ReaderFlow } from "../core/reader";
import { Quiz } from "../core/quiz";
import { commitReply } from "../core/study";
import { Chapter } from "../core/models";
import * as storage from "../services/storage";
import { seedLibrary, clearUserData } from "../services/library";
import seed from "../data/seed";
import { installStorage } from "./helpers";
let mock: ReturnType<typeof installStorage>;
beforeEach(() => {
  mock = installStorage();
});
const chapter = (bookId: string, id = "c1"): Chapter => ({
  id,
  bookId,
  title: id,
  rawText: "Hello world. Read again!",
  tokens: tokenize("Hello world. Read again!"),
  words: [{ word: "hello", meaning: "你好" }],
  translations: ["你好，世界。", "再读一次！"],
  quizDone: false,
  createdAt: 1,
  translatedAt: 1,
});

test("tokenization handles abbreviations, decimals, quotes and contractions", () => {
  assert.deepEqual(
    splitSentences("Dr. Smith paid 3.14 dollars. “Really?” Yes!"),
    ["Dr. Smith paid 3.14 dollars.", "“Really?”", "Yes!"],
  );
  const tokens = tokenize("Don't give up.\nTry again!");
  assert.equal(tokens.sentences.length, 2);
  assert.equal(joinTokens(tokens.paragraphs[0].tokens), "Don't give up.");
  assert.equal(
    new Set(tokens.paragraphs.flatMap((p) => p.tokens.map((t) => t.id))).size,
    tokens.tokenCount,
  );
});
test("all built-in chapters preserve original token IDs and translation alignment", () => {
  const source = execFileSync("git", ["show", "8538f4b:utils/tokenize.js"], {
    encoding: "utf8",
  });
  const sandbox = {
    module: { exports: {} },
    require: () => ({ hash: () => "" }),
  };
  vm.runInNewContext(source, sandbox);
  const original = sandbox.module.exports as {
    tokenizeArticle(title: string, text: string): ReturnType<typeof tokenize>;
  };
  let count = 0;
  for (const book of seed.books)
    for (const ch of book.chapters) {
      const old = original.tokenizeArticle(ch.title, ch.text),
        fresh = tokenize(ch.text);
      assert.equal(
        JSON.stringify(fresh.sentences),
        JSON.stringify(old.sentences),
        ch.id,
      );
      assert.equal(
        JSON.stringify(
          fresh.paragraphs.map((p) =>
            p.tokens.map(({ id, w, sid }) => ({ id, w, sid })),
          ),
        ),
        JSON.stringify(old.paragraphs.map((p) => p.tokens)),
        ch.id,
      );
      assert.equal(ch.translations.length, fresh.sentences.length, ch.id);
      count++;
    }
  assert.equal(count, 60);
});
test("reader selections and marks remain in their chapter across a continuous stream", () => {
  const flow = new ReaderFlow();
  flow.append(chapter("b", "one"), [], []);
  flow.append(
    chapter("b", "two"),
    [{ start: 0, end: 0, text: "Hello", createdAt: 1 }],
    [],
  );
  const second = flow.tokens.find((t) => t.cid === "two")!;
  flow.select(second.globalId, second.globalId + 1);
  assert.deepEqual(flow.ranges(), [
    { cid: "two", start: 0, end: 1, text: "Hello world" },
  ]);
  assert.equal(second.marked, true);
  flow.select(second.globalId - 1, second.globalId);
  assert.deepEqual(
    flow.ranges().map((r) => r.cid),
    ["one", "two"],
  );
  assert.deepEqual(
    flow.sentence(second.globalId).map((t) => t.cid),
    ["two", "two", "two"],
  );
});
test("quiz options are distinct, missed words repeat, first-try score is stable", () => {
  const session = new Quiz(
    [
      { word: "one", meaning: "一" },
      { word: "two", meaning: "二" },
      { word: "second", meaning: "二" },
    ],
    () => 0.3,
  );
  const first = session.next()!;
  assert.equal(new Set(first.options).size, first.options.length);
  session.answer(false);
  assert.equal(session.wrong, 1);
  session.next();
  session.answer(true);
  session.next();
  session.answer(true);
  assert.equal(session.next()?.word, "one");
  session.answer(true);
  assert.equal(session.next(), null);
  assert.equal(session.passed, 2);
  assert.equal(session.right, 3);
});
test("settings preserve nonstandard user keys and custom endpoints", () => {
  storage.write("settings", {
    apiKey: "custom-token",
    baseUrl: "https://custom.example/v1",
    model: "my-model",
    sfApiKey: "",
  });
  assert.equal(storage.settings().apiKey, "custom-token");
  assert.equal(storage.settings().baseUrl, "https://custom.example/v1");
  assert.equal(storage.settings().sfApiKey, "");
  storage.write("settings", { quizCount: "bad", ttsSpeed: 9 });
  assert.equal(storage.settings().quizCount, 30);
  assert.equal(storage.settings().ttsSpeed, 1);
});
test("failed chapter save rolls back chapter data and index", () => {
  const book = storage.createBook("Test");
  const ch = chapter(book.id);
  storage.saveChapter(ch);
  mock.failOnce("book_index");
  assert.throws(
    () => storage.saveChapter({ ...ch, title: "Changed" }),
    /原数据已恢复/,
  );
  assert.equal(storage.chapter(book.id, ch.id)?.title, "c1");
  assert.equal(storage.book(book.id)?.chapters[0].title, "c1");
});
test("backup round trip preserves annotations, user settings and learning history", () => {
  const b = storage.createBook("Test");
  storage.saveChapter(chapter(b.id));
  storage.write("marks_c1", [
    { start: 0, end: 1, text: "Hello world", createdAt: 1 },
  ]);
  storage.saveSettings({ apiKey: "private-token" });
  storage.write("study_state", {
    ...storage.emptyStudy(),
    phase: "assess",
    assess: { total: 24, asked: 7 },
  });
  const backup = storage.exportBackup();
  mock.values.clear();
  storage.importBackup(backup);
  assert.equal(storage.books()[0].id, b.id);
  assert.equal(storage.marks("c1").length, 1);
  assert.equal(storage.settings().apiKey, "private-token");
  assert.equal(storage.study().assess?.asked, 7);
});
test("malformed and incomplete backups do not alter current data", () => {
  storage.createBook("Keep");
  const before = storage.exportBackup().data;
  assert.throws(
    () =>
      storage.importBackup({
        version: 3,
        data: {
          book_index: [{ id: "b", title: "Missing", chapters: [{ id: "c" }] }],
        },
      }),
    /缺少完整章节/,
  );
  assert.deepEqual(storage.exportBackup().data, before);
  assert.throws(
    () => storage.importBackup({ version: 3, data: { vocab: "bad" } }),
    /格式错误/,
  );
});
test("seeding is idempotent and never clears marks or progress", () => {
  seedLibrary();
  assert.equal(storage.books().length, seed.books.length);
  const b = storage.books()[0],
    cid = b.chapters[0].id;
  storage.completeChapter(b.id, cid);
  storage.write("marks_" + cid, [
    { start: 1, end: 2, text: "test", createdAt: 1 },
  ]);
  storage.write("words_ver", 0);
  seedLibrary();
  assert.equal(storage.chapter(b.id, cid)?.quizDone, true);
  assert.equal(storage.marks(cid).length, 1);
  storage.deleteBook(b.id);
  seedLibrary();
  assert.equal(storage.book(b.id), null);
});
test("deletion clears stale favorites and learning references but keeps saved sentences", () => {
  const b = storage.createBook("Test");
  storage.saveChapter(chapter(b.id));
  storage.toggleFavorite({
    bookId: b.id,
    chapterId: "c1",
    title: "c1",
    bookTitle: b.title,
  });
  storage.addSentence({
    text: "Hello world.",
    translation: "你好",
    bookId: b.id,
    chapterId: "c1",
    bookTitle: b.title,
    chapterTitle: "c1",
  });
  storage.write("study_state", {
    ...storage.emptyStudy(),
    phase: "reading",
    plan: {
      text: "",
      chapters: [{ bookId: b.id, chapterId: "c1", title: "", done: false }],
      createdAt: 1,
    },
  });
  storage.deleteChapter(b.id, "c1");
  assert.equal(storage.favorites().length, 0);
  assert.equal(storage.study().phase, "idle");
  assert.equal(storage.sentences().length, 1);
});
test("chapter completion updates plan and index in one transaction", () => {
  const b = storage.createBook("Test");
  storage.saveChapter(chapter(b.id));
  storage.write("study_state", {
    ...storage.emptyStudy(),
    phase: "reading",
    plan: {
      text: "",
      chapters: [{ bookId: b.id, chapterId: "c1", title: "", done: false }],
      createdAt: 1,
    },
  });
  storage.completeChapter(b.id, "c1");
  assert.equal(storage.chapter(b.id, "c1")?.quizDone, true);
  assert.equal(storage.book(b.id)?.chapters[0].quizDone, true);
  assert.equal(storage.study().plan?.chapters[0].done, true);
});
test("clearing data retains built-in books and optionally keeps settings", () => {
  seedLibrary();
  storage.createBook("Custom");
  storage.saveSettings({ apiKey: "saved-key" });
  storage.addVocab({ word: "hi", translation: "你好", createdAt: 1 });
  clearUserData(false);
  assert.equal(storage.books().length, seed.books.length);
  assert.equal(storage.vocab().length, 0);
  assert.equal(storage.settings().apiKey, "saved-key");
  clearUserData(true);
  assert.equal(storage.settings().apiKey, "");
});
test("assessment counts actual successful answers, not the initial question", () => {
  const initial = {
    ...storage.emptyStudy(),
    phase: "assess" as const,
    assess: { total: 24, asked: 0 },
    qa: { messages: [] },
  };
  const response = {
    reply: "Question",
    question: {
      type: "choice" as const,
      title: "Q",
      options: ["a", "b", "c", "d"],
    },
    memory: "Profile",
    plan: null,
  };
  const question = commitReply(initial, "start", response, 0);
  assert.equal(question.assess?.asked, 0);
  const answered = commitReply(question, "a", response, 1);
  assert.equal(answered.assess?.asked, 1);
  assert.equal(initial.assess.asked, 0);
  assert.equal(answered.qa?.messages.length, 4);
});
