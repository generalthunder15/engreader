import * as repo from "./learning-repository";
import { session, commit } from "./learning-repository";
import { learningPrompts as prompts } from "./learning-prompts";
import { closed } from "../core/learning";
import { archiveInput } from "../core/learning-memory";
import { chat } from "./ai";
// Serialize archive merges across sessions. A stale response can never overwrite a manual edit/reset.
let memoryQueue: Promise<void> = Promise.resolve();
export function archiveMemory(sid: string): Promise<void> {
  const work = memoryQueue
    .catch(() => {})
    .then(async () => {
      let s = session(sid);
      if (!closed(s)) throw new Error("对话结束归档后才能更新长期记忆");
      if (repo.catalog().memory.archivedSessions.includes(sid)) return;
      if (!s.archiveSummary) {
        const source = archiveInput(s);
        const records = [...source.rounds, ...source.exam];
        const chunks: unknown[][] = [[]];
        for (const row of records) {
          const last = chunks[chunks.length - 1];
          if (
            last.length &&
            JSON.stringify(last).length + JSON.stringify(row).length > 14000
          )
            chunks.push([]);
          chunks[chunks.length - 1].push(row);
        }
        const notes: string[] = [];
        for (const rows of chunks)
          notes.push(
            await memoryText(prompts.archiveChunk, {
              sessionId: source.sessionId,
              title: source.title,
              date: source.date,
              introduction: source.introduction,
              articleSummary: source.articleSummary,
              requirements: source.requirements,
              records: rows,
            }),
          );
        s.archiveSummary = notes.join("\n\n");
        commit(s);
      }
      const state = repo.catalog(),
        revision = state.memory.revision;
      const markdown = await memoryText(prompts.archive, {
        previousMarkdown: state.memory.markdown,
        archivedConversation: s.archiveSummary,
      });
      const latest = repo.catalog();
      const current = session(sid);
      if (
        !current ||
        current.revision !== s.revision ||
        latest.memory.revision !== revision
      )
        throw new Error("记忆或对话已变更，请重试归档总结");
      latest.memory = {
        markdown,
        revision: revision + 1,
        updatedAt: Date.now(),
        archivedSessions: [...latest.memory.archivedSessions, sid],
      };
      current.memoryError = "";
      commit(current, { [repo.MEMORY]: latest.memory });
    });
  memoryQueue = work;
  return work;
}
async function memoryText(prompt: string, context: unknown): Promise<string> {
  const text = (
    await chat(
      [
        { role: "system", content: prompt },
        { role: "user", content: JSON.stringify(context) },
      ],
      false,
      false,
    )
  )
    .trim()
    .replace(/^```(?:markdown|md)?\s*\n/i, "")
    .replace(/\n```$/, "")
    .trim();
  if (!text || /^[{[]/.test(text) || text.length > 16000)
    throw new Error("记忆总结格式不正确或过长，请重试");
  return text;
}
export async function summarizeClosed(sid: string): Promise<void> {
  try {
    await archiveMemory(sid);
  } catch (error) {
    // Completion/grading is already durable. Retrying memory must never re-grade a paper.
    const s = repo.catalog().sessions.some((row) => row.id === sid)
      ? session(sid)
      : null;
    if (s) {
      s.memoryError = error instanceof Error ? error.message : "记忆总结失败";
      commit(s);
    }
  }
}
