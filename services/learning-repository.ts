import { PAPER } from "../core/learning-flow";
import {
  Learning,
  Session,
  Turn,
  Memory,
  emptyLearning,
  discardLegacySessions,
  complete,
} from "../core/learning";
import { migrateMemory } from "../core/learning-memory";
import { read, transaction } from "./local-storage";

/** Legacy key remains only as an import/migration boundary. */
export const KEY = "learning_v1";
export const INDEX = "learning_v2_index";
export const MEMORY = "learning_v2_memory";
export const PAGE_SIZE = 20;
export type SessionSummary = Pick<
  Session,
  "id" | "kind" | "title" | "phase" | "number" | "memoryError"
> & { completed: boolean };
type StoredSession = Omit<Session, "messages"> & { messageCount: number };
const sessionKey = (sid: string) => `learning_v2_session_${sid}`;
const pageKey = (sid: string, page: number) =>
  `learning_v2_messages_${sid}_${page}`;
const summary = (s: Session): SessionSummary => ({
  id: s.id,
  kind: s.kind,
  title: s.title,
  phase: s.phase,
  number: s.number,
  memoryError: s.memoryError || "",
  completed: complete(s),
});

function encode(s: Session): Record<string, unknown> {
  const { messages, ...rest } = s;
  const values: Record<string, unknown> = {
    [sessionKey(s.id)]: { ...rest, messageCount: messages.length },
  };
  for (let i = 0; i < messages.length; i += PAGE_SIZE)
    values[pageKey(s.id, i / PAGE_SIZE)] = messages.slice(i, i + PAGE_SIZE);
  return values;
}

function ensure(): void {
  const legacy = read<Learning | null>(KEY, null);
  if (!legacy && read(INDEX, null)) return;
  const state = legacy ? discardLegacySessions(legacy) : emptyLearning();
  state.memory = migrateMemory(state.memory, state.sessions);
  for (const s of state.sessions) {
    if (
      s.kind === "lesson" &&
      (s.phase === "teaching" ||
        (s.phase === "reading" && s.generationStep < PAPER.readyStep))
    ) {
      s.phase =
        s.generationStep === PAPER.readyStep ? "reading" : "exam-generating";
      s.pending = null;
      s.revision++;
    }
  }
  const values: Record<string, unknown> = {
    [INDEX]: state.sessions.map(summary),
    [MEMORY]: state.memory,
  };
  state.sessions.forEach((s) => Object.assign(values, encode(s)));
  const removed = wx
    .getStorageInfoSync()
    .keys.filter((k) => k.startsWith("learning_v2_") && !(k in values));
  // Keep the original until every split record is durably written.
  transaction(values, [...removed, KEY, "study_state"]);
}

export function catalog(): { sessions: SessionSummary[]; memory: Memory } {
  ensure();
  return {
    sessions: read<SessionSummary[]>(INDEX, []),
    memory: read<Memory>(MEMORY, emptyLearning().memory),
  };
}
export function canCreateLesson(): boolean {
  const state = catalog();
  return (
    state.sessions.some(
      (s) => s.kind === "assessment" && s.phase === "archived",
    ) &&
    state.sessions.every(
      (s) =>
        (s.phase !== "complete" && s.phase !== "archived") ||
        state.memory.archivedSessions.includes(s.id),
    ) &&
    state.sessions.every(
      (s) => s.kind !== "lesson" || (s.phase === "complete" && s.completed),
    )
  );
}
export function session(sid: string, withMessages = true): Session {
  ensure();
  const value = read<StoredSession | null>(sessionKey(sid), null);
  if (!value) throw new Error("对话不存在");
  const { messageCount, ...rest } = value;
  return {
    ...rest,
    messages: withMessages ? messages(sid, 0, messageCount) : [],
  };
}
export function messages(sid: string, start: number, end: number): Turn[] {
  ensure();
  const rows: Turn[] = [];
  for (
    let p = Math.floor(start / PAGE_SIZE);
    p < Math.ceil(end / PAGE_SIZE);
    p++
  ) {
    const page = read<Turn[] | null>(pageKey(sid, p), null);
    if (!page) throw new Error("对话记录不完整，请保留数据后重试");
    rows.push(
      ...page.slice(
        Math.max(0, start - p * PAGE_SIZE),
        Math.min(PAGE_SIZE, end - p * PAGE_SIZE),
      ),
    );
  }
  return rows;
}
/** Read only enough storage pages to fill the visible conversation window. */
export function recentMessages(
  sid: string,
  count: number,
): { messages: Turn[]; hasOlder: boolean } {
  ensure();
  const value = read<StoredSession | null>(sessionKey(sid), null);
  if (!value) throw new Error("对话不存在");
  let end = value.messageCount;
  let rows: Turn[] = [];
  while (end > 0 && rows.length <= count) {
    const start = Math.max(0, end - PAGE_SIZE);
    rows = messages(sid, start, end)
      .filter((m) => !m.notice && !m.articleId)
      .concat(rows);
    end = start;
  }
  return {
    messages: rows.slice(-count),
    hasOlder: end > 0 || rows.length > count,
  };
}
/** Full snapshot is for backup/testing only, never the ordinary page refresh path. */
export function load(): Learning {
  const state = catalog();
  return {
    version: 1,
    memory: state.memory,
    sessions: state.sessions.map((s) => session(s.id)),
  };
}
export function insert(s: Session): void {
  const state = catalog();
  if (state.sessions.some((row) => row.id === s.id))
    throw new Error("对话已存在");
  transaction({ ...encode(s), [INDEX]: [...state.sessions, summary(s)] });
}
export function commit(s: Session, extra: Record<string, unknown> = {}): void {
  const current = session(s.id, false);
  if (current.revision !== s.revision)
    throw new Error("学习记录已更新，请重新打开当前对话");
  const stored = read<StoredSession>(sessionKey(s.id), {} as StoredSession);
  if (s.messages.length < stored.messageCount)
    throw new Error("不能使用未加载完整消息的对话覆盖历史记录");
  const next = { ...s, revision: s.revision + 1 };
  const values = encode(next);
  // Completed history pages stay untouched; an append writes only the last/new pages.
  for (const key of Object.keys(values))
    if (JSON.stringify(read(key, null)) === JSON.stringify(values[key]))
      delete values[key];
  const state = catalog();
  const index = state.sessions.map((row) =>
    row.id === s.id ? summary(next) : row,
  );
  if (JSON.stringify(index) !== JSON.stringify(state.sessions))
    values[INDEX] = index;
  transaction({ ...values, ...extra });
  s.revision = next.revision;
}
export function saveMemory(memory: Memory): void {
  ensure();
  transaction({ [MEMORY]: memory });
}
