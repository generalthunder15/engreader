import { Book, ChapterMeta } from "./models";
export type OutlineBook = Omit<Book, "chapters"> & { chapters: (ChapterMeta & { examId?: string })[] };
export function bookOutline(book: Book, pairs: { articleId: string; examId: string }[]): OutlineBook {
  const attached = new Map<string, string>();
  for (const pair of pairs) {
    if (book.chapters.some(c => c.id === pair.articleId && c.kind !== "exam") && book.chapters.some(c => c.id === pair.examId && c.kind === "exam")) attached.set(pair.articleId, pair.examId);
  }
  const exams = new Set(attached.values());
  const chapters = book.chapters.filter(c => !exams.has(c.id)).map(c => ({ ...c, ...(attached.has(c.id) ? { examId: attached.get(c.id) } : {}) }));
  return { ...book, chapters, chapterCount: chapters.length,
    lastChapterId: chapters.find(c => c.id === book.lastChapterId || c.examId === book.lastChapterId)?.id || book.lastChapterId };
}
