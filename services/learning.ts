/** Public learning API. Orchestration lives in focused domain modules. */
import * as store from "./storage";
import * as repo from "./learning-repository";
import { AI_BOOK, newSession } from "../core/learning";
import { id } from "../core/models";
export {
  KEY,
  load,
  session,
  catalog,
  recentMessages,
  canCreateLesson,
} from "./learning-repository";
export { isBusy } from "./learning-runtime";
export { archiveMemory } from "./learning-archive";
export {
  generationLabel,
  generateStep,
  unlockExam,
} from "./learning-generation";
export { beginAssessment, continueConversation } from "./learning-conversation";
export { submitExam, gradeExam, gradeStandalone } from "./learning-exam";
export { askAside } from "./learning-aside";
export function initialize(): void {
  repo.catalog();
  if (!store.book(AI_BOOK))
    store.write("book_index", [
      {
        id: AI_BOOK,
        title: "AI 学习",
        author: "你的英语教练",
        hue: 160,
        chapters: [],
        chapterCount: 0,
        createdAt: Date.now(),
        lastReadAt: 0,
        lastChapterId: "",
      },
      ...store.books(),
    ]);
}
export function updateMemory(markdown: string): void {
  if (markdown.length > 16000)
    throw new Error("记忆文档过长，请先精简到16000字以内");
  const state = repo.catalog();
  state.memory = {
    ...state.memory,
    markdown: markdown.trim(),
    revision: state.memory.revision + 1,
    updatedAt: Date.now(),
  };
  repo.saveMemory(state.memory);
}
export function createAssessment(): string {
  initialize();
  const state = repo.catalog();
  const old = state.sessions.find((s) => s.kind === "assessment");
  if (old) return old.id;
  const s = newSession(id(), "assessment");
  repo.insert(s);
  return s.id;
}
export function createLesson(): string {
  initialize();
  const state = repo.catalog();
  if (!repo.canCreateLesson())
    throw new Error("请先完成测评、当前课程和归档记忆更新");
  const number =
    Math.max(
      0,
      ...state.sessions.filter((s) => s.kind === "lesson").map((s) => s.number),
    ) + 1;
  const s = newSession(id(), "lesson", number);
  repo.insert(s);
  return s.id;
}
