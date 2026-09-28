import * as store from "./storage";
import * as repo from "./learning-repository";
import { chat, parseJSON } from "./ai";
import { learningPrompts as prompts } from "./learning-prompts";
import { shortMemory, Supplement } from "../core/learning-memory";
import { AI_BOOK, Session, Exercise } from "../core/learning";
import { id, record } from "../core/models";
const busy = new Set<string>();
export const isBusy = (sid: string): boolean => busy.has(sid);
export async function exclusive<T>(
  sid: string,
  work: () => Promise<T>,
): Promise<T> {
  if (busy.has(sid)) throw new Error("当前操作正在进行");
  busy.add(sid);
  try {
    return await work();
  } finally {
    busy.delete(sid);
  }
}
export async function askJSON(
  prompt: string,
  context: unknown,
): Promise<Record<string, unknown>> {
  return record(
    parseJSON(
      await chat([
        { role: "system", content: prompts.system + "\n" + prompt },
        { role: "user", content: JSON.stringify(context) },
      ]),
    ),
  );
}
export function context(s: Session): unknown {
  return {
    memoryMarkdown: repo.catalog().memory.markdown,
    phase: s.phase,
    review: s.review,
    targets: s.targets,
    article: store.chapter(AI_BOOK, s.articleId)?.rawText,
    summary: s.summary,
    shortTerm: shortMemory(s),
  };
}
export async function classifySupplement(text: string): Promise<Supplement> {
  if (!text.trim()) return { question: "", request: "" };
  const value = record(
    parseJSON(
      await chat([
        { role: "system", content: prompts.classify },
        { role: "user", content: JSON.stringify({ supplement: text.trim() }) },
      ]),
    ),
  );
  if (
    typeof value.question !== "string" ||
    typeof value.request !== "string" ||
    value.question.length > 5000 ||
    value.request.length > 5000
  )
    throw new Error("补充内容分类失败，请重试");
  return { question: value.question.trim(), request: value.request.trim() };
}

export function add(
  s: Session,
  role: "user" | "assistant",
  content: string,
  question?: Exercise,
  notice = false,
): void {
  s.messages.push({
    id: id(),
    role,
    content,
    ts: Date.now(),
    ...(notice ? { notice: true } : {}),
    ...(question ? { question } : {}),
  });
}
