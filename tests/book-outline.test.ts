import test from "node:test";
import assert from "node:assert/strict";
import { bookOutline } from "../core/book-outline";
import { Book, ChapterMeta } from "../core/models";
const meta = (id: string, kind: "article" | "exam"): ChapterMeta => ({ id, kind, title: id, wordCount: 1, translated: false, quizDone: true, createdAt: 1 });
test("course papers attach to their own articles without interrupting article order or resume", () => {
  const book: Book = { id: "ai_learning", title: "AI", author: "", hue: 1, chapterCount: 4, chapters: [meta("a1", "article"), meta("e1", "exam"), meta("a2", "article"), meta("standalone", "exam")], createdAt: 1, lastReadAt: 1, lastChapterId: "e1" };
  const outline = bookOutline(book, [{ articleId: "a1", examId: "e1" }, { articleId: "a2", examId: "locked-paper" }]);
  assert.deepEqual(outline.chapters.map(c => c.id), ["a1", "a2", "standalone"]);
  assert.equal(outline.chapters[0].examId, "e1");
  assert.equal(outline.chapters[1].examId, undefined);
  assert.equal(outline.lastChapterId, "a1");
  assert.equal(book.chapters.length, 4);
  assert.equal(book.lastChapterId, "e1");
  assert.deepEqual(bookOutline(book, []).chapters.map(c => c.id), book.chapters.map(c => c.id));
});
