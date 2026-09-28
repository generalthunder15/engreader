import { PAPER } from "./learning-flow";
import { migrateMemory } from "./learning-memory";
import type { LearningRound } from "./learning-memory";
import { Message, record, strings } from "./models";

export const AI_BOOK = "ai_learning";
export type Phase =
  | "intro"
  | "assessment"
  | "generating"
  | "reading"
  | "teaching" // Legacy storage only; migrated to exercise preparation on load.
  | "exam-generating"
  | "exam"
  | "grading"
  | "remediation"
  | "complete"
  | "archived";
export interface Exercise {
  id: string;
  type: "choice" | "fill" | "translation";
  title: string;
  material?: string;
  options: string[];
  answer: string;
  explanation: string;
  points: string[];
  direction?: "en-zh" | "zh-en";
}
export interface ExamSection {
  id: string;
  title: string;
  material: string;
  questions: Exercise[];
}
export interface Grade {
  id: string;
  correct: boolean;
  feedback: string;
  points: string[];
}
export interface Attempt {
  answers: Record<string, string>;
  submittedAt: number;
  grades: Grade[];
}
export interface Evidence {
  point: string;
  question: Exercise;
  answer: string;
  correct: boolean;
  feedback: string;
  at: number;
}
export interface Turn extends Message {
  id: string;
  question?: Exercise;
  answerTo?: string;
  notice?: boolean;
  articleId?: string;
}
export interface Session {
  id: string;
  kind: "assessment" | "lesson";
  title: string;
  phase: Phase;
  number: number;
  review: boolean;
  createdAt: number;
  revision: number;
  messages: Turn[];
  pending: Exercise | null;
  assessed: number;
  articleId: string;
  examId: string;
  summary: string;
  targets: string[];
  sections: ExamSection[];
  generationStep: number;
  attempt: Attempt | null;
  evidence: Evidence[];
  assessmentEvidence: Evidence[];
  introduction?: string;
  rounds?: LearningRound[];
  requests?: string[];
  archiveSummary?: string;
  memoryError?: string;
}
export interface Memory {
  markdown: string;
  revision: number;
  updatedAt: number;
  archivedSessions: string[];
}
export interface Learning {
  version: 1;
  sessions: Session[];
  memory: Memory;
}
export const emptyLearning = (): Learning => ({
  version: 1,
  sessions: [],
  memory: { markdown: "", revision: 0, updatedAt: 0, archivedSessions: [] },
});
export const closed = (s: Pick<Session, "phase">): boolean =>
  s.phase === "complete" || s.phase === "archived";
export const unresolved = (s: Session): string[] => {
  const originals = s.sections.flatMap((section) => section.questions);
  return [
    ...new Set(
      (s.attempt?.grades || [])
        .filter((g) => !g.correct)
        .flatMap((g) => g.points),
    ),
  ].filter(
    (point) =>
      !s.evidence.some(
        (e) =>
          e.point === point &&
          e.correct &&
          e.at >= (s.attempt?.submittedAt || Infinity) &&
          e.question.points.length === 1 &&
          e.question.points[0] === point &&
          !originals.some(
            (q) =>
              q.id === e.question.id ||
              q.title.trim().toLowerCase() ===
                e.question.title.trim().toLowerCase(),
          ),
      ),
  );
};
export function complete(s: Session): boolean {
  const ids = s.sections.flatMap((section) =>
    section.questions.map((q) => q.id),
  );
  return (
    s.kind === "lesson" &&
    !!s.attempt?.submittedAt &&
    ids.length > 0 &&
    s.attempt.grades.length === ids.length &&
    new Set(s.attempt.grades.map((g) => g.id)).size === ids.length &&
    ids.every((id) => s.attempt!.grades.some((g) => g.id === id)) &&
    s.attempt.grades.every((g) => g.correct || g.points.length > 0) &&
    unresolved(s).length === 0
  );
}
export function canStart(state: Learning): boolean {
  return (
    state.sessions.some(
      (s) => s.kind === "assessment" && s.phase === "archived",
    ) &&
    state.sessions
      .filter(closed)
      .every((s) => state.memory.archivedSessions.includes(s.id)) &&
    state.sessions.every(
      (s) => s.kind !== "lesson" || (s.phase === "complete" && complete(s)),
    )
  );
}
export function newSession(
  id: string,
  kind: Session["kind"],
  number = 0,
): Session {
  return {
    id,
    kind,
    title:
      kind === "assessment"
        ? "初始水平测评"
        : `第 ${number} 课${number % 3 === 0 ? " · 复习" : ""}`,
    phase: kind === "assessment" ? "intro" : "generating",
    number,
    review: number > 0 && number % 3 === 0,
    createdAt: Date.now(),
    revision: 0,
    messages: [],
    pending: null,
    assessed: 0,
    articleId: `${id}_article`,
    examId: `${id}_exam`,
    summary: "",
    targets: [],
    sections: [],
    generationStep: 0,
    attempt: null,
    evidence: [],
    assessmentEvidence: [],
  };
}
export function required(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`模型返回的${name}不完整，请重试`);
  return value.trim();
}
export function parseExercise(raw: unknown, id: string): Exercise {
  const q = record(raw);
  if (!["choice", "fill", "translation"].includes(String(q.type)))
    throw new Error("题型不正确，请重试");
  const options = strings(q.options).map((v) => v.trim());
  if (
    q.type === "choice" &&
    (options.length !== 4 ||
      options.some((v) => !v) ||
      new Set(options).size !== 4)
  )
    throw new Error("选择题需要四个不同的完整选项");
  const answer = required(q.answer, "参考答案");
  if (q.type === "choice" && !["A", "B", "C", "D"].includes(answer))
    throw new Error("选择题答案必须为 A、B、C 或 D");
  const points = strings(q.points)
    .map((v) => v.trim())
    .filter(Boolean);
  if (!points.length) throw new Error("题目缺少知识点");
  if (
    q.type === "translation" &&
    !["en-zh", "zh-en"].includes(String(q.direction))
  )
    throw new Error("翻译方向不完整");
  return {
    id,
    type: q.type as Exercise["type"],
    title: required(q.title, "题干"),
    ...([q.material, q.passage, q.context].some(
      (v) => typeof v === "string" && v.trim(),
    )
      ? {
          material: String(
            [q.material, q.passage, q.context].find(
              (v) => typeof v === "string" && v.trim(),
            ),
          ).trim(),
        }
      : {}),
    options: q.type === "choice" ? options : [],
    answer,
    explanation: required(q.explanation, "解析"),
    points,
    ...(q.type === "translation"
      ? { direction: q.direction as "en-zh" | "zh-en" }
      : {}),
  };
}
export function parseGrades(raw: unknown, questions: Exercise[]): Grade[] {
  const rows = record(raw).grades;
  if (!Array.isArray(rows) || rows.length !== questions.length)
    throw new Error("批改结果漏题，请重试");
  const seen = new Set<string>();
  return rows.map((row) => {
    const g = record(row),
      q = questions.find((q) => q.id === g.id);
    if (!q || seen.has(q.id) || typeof g.correct !== "boolean")
      throw new Error("批改题号或结果无效，请重试");
    seen.add(q.id);
    return {
      id: q.id,
      correct: g.correct,
      feedback: required(g.feedback, "批改说明"),
      points: q.points,
    };
  });
}
export function sessionSteps(
  s: Session | null,
): { label: string; status: "done" | "current" | "pending" }[] {
  if (!s) return [];
  const assessment = s.kind === "assessment";
  const labels = assessment
    ? ["介绍", "测评", "报告"]
    : ["生成", "阅读·闯关", "答卷", "批改", "复测", "完成"];
  const index = assessment
    ? s.phase === "intro"
      ? 0
      : s.phase === "assessment"
        ? 1
        : 2
    : ((
        {
          generating: 0,
          "exam-generating": 0,
          reading: 1,
          teaching: 0,
          exam: 2,
          grading: 3,
          remediation: 4,
          complete: 5,
        } as Partial<Record<Phase, number>>
      )[s.phase] ?? 0);
  const finished = s.phase === "complete" || s.phase === "archived";
  return labels.map((label, i) => ({
    label,
    status:
      finished || i < index ? "done" : i === index ? "current" : "pending",
  }));
}

export const phaseLabel: Record<Phase, string> = {
  intro: "先介绍一下自己",
  assessment: "水平测评",
  generating: "生成学习文章",
  reading: "阅读与单词闯关",
  teaching: "准备配套题目",
  "exam-generating": "准备配套题目",
  exam: "试卷作答",
  grading: "等待批改",
  remediation: "错题补学",
  complete: "本课已完成",
  archived: "已归档 · 只读",
};

/** Validate a restore before it can change the live learning state. */
export function validateLearningBackup(
  raw: unknown,
  data: Record<string, unknown>,
): void {
  const state = record(raw);
  if (state.version !== 1 || !Array.isArray(state.sessions))
    throw new Error("学习备份结构不完整");
  const memory = migrateMemory(state.memory, state.sessions as Session[]);
  if (
    typeof memory.markdown !== "string" ||
    !Number.isFinite(memory.revision) ||
    !Number.isFinite(memory.updatedAt) ||
    !Array.isArray(memory.archivedSessions) ||
    memory.archivedSessions.some((id) => typeof id !== "string")
  )
    throw new Error("长期记忆格式不正确");
  const ids = new Set<string>();
  let active = 0,
    assessments = 0;
  for (const rawSession of state.sessions) {
    const r = record(rawSession);
    if (
      typeof r.id !== "string" ||
      ids.has(r.id) ||
      !["assessment", "lesson"].includes(String(r.kind)) ||
      !Object.prototype.hasOwnProperty.call(phaseLabel, String(r.phase)) ||
      !Array.isArray(r.sections) ||
      !Array.isArray(r.messages) ||
      !Array.isArray(r.evidence) ||
      !Array.isArray(r.assessmentEvidence) ||
      typeof r.revision !== "number" ||
      typeof r.generationStep !== "number" ||
      typeof r.assessed !== "number"
    )
      throw new Error("对话记录格式不正确");
    const s = rawSession as Session;
    ids.add(s.id);
    if (s.kind === "assessment") assessments++;
    if (s.kind === "lesson" && !closed(s)) active++;
    if (
      s.kind === "lesson" &&
      (s.phase === "archived" ||
        !Number.isInteger(s.number) ||
        s.number < 1 ||
        s.review !== (s.number % 3 === 0))
    )
      throw new Error("课程状态不正确");
    for (const m of s.messages)
      if (
        typeof m.content !== "string" ||
        !["user", "assistant", "system"].includes(m.role)
      )
        throw new Error("对话消息格式不正确");
    const questionIds = new Set<string>();
    for (const section of s.sections) {
      if (
        typeof section.id !== "string" ||
        typeof section.material !== "string" ||
        !Array.isArray(section.questions)
      )
        throw new Error("试卷部分不完整");
      for (const q of section.questions) {
        if (typeof q.id !== "string" || questionIds.has(q.id))
          throw new Error("试卷题号重复");
        parseExercise(q, q.id);
        questionIds.add(q.id);
      }
    }
    for (const e of [...s.evidence, ...s.assessmentEvidence]) {
      if (
        typeof e.point !== "string" ||
        typeof e.answer !== "string" ||
        typeof e.feedback !== "string" ||
        typeof e.correct !== "boolean" ||
        !Number.isFinite(e.at)
      )
        throw new Error("学习证据不完整");
      parseExercise(e.question, e.question.id);
    }
    if (s.pending) parseExercise(s.pending, s.pending.id);
    if (s.attempt) {
      const questions = s.sections.flatMap((section) => section.questions);
      if (
        typeof s.attempt.submittedAt !== "number" ||
        !s.attempt.submittedAt ||
        !Array.isArray(s.attempt.grades) ||
        questions.some(
          (q) => typeof record(s.attempt!.answers)[q.id] !== "string",
        )
      )
        throw new Error("答卷不完整");
      if (s.attempt.grades.length) {
        const canonical = parseGrades({ grades: s.attempt.grades }, questions);
        if (
          canonical.some(
            (g) =>
              JSON.stringify(g.points) !==
              JSON.stringify(
                s.attempt!.grades.find((v) => v.id === g.id)?.points,
              ),
          )
        )
          throw new Error("批改知识点与题目不符");
      }
    }
    if (s.kind === "lesson" && s.phase !== "generating") {
      const article = record(data[`chapter_${AI_BOOK}_${s.articleId}`]);
      if (article.sessionId !== s.id || article.kind !== "article")
        throw new Error("备份缺少关联的学习文章");
    }
    if (["exam", "grading", "remediation", "complete"].includes(s.phase)) {
      const exam = record(data[`chapter_${AI_BOOK}_${s.examId}`]);
      if (
        s.generationStep !== PAPER.readyStep ||
        s.sections.flatMap((v) => v.questions).length !== PAPER.totalQuestions ||
        exam.sessionId !== s.id ||
        JSON.stringify(exam.sections) !== JSON.stringify(s.sections)
      )
        throw new Error("备份缺少完整的关联试卷");
    }
    if (s.phase === "complete" && !complete(s))
      throw new Error("课程缺少通过证据，不能恢复为已完成");
    if (s.kind === "assessment" && s.phase === "archived" && s.assessed !== 24)
      throw new Error("测评尚未完成");
  }
  if (active > 1 || assessments > 1) throw new Error("备份包含冲突的学习会话");
}

/** Remove retired conversations without changing current course progress. */
export function discardLegacySessions(state: Learning): Learning {
  if (!Array.isArray(state.sessions)) throw new Error("学习记录格式不正确");
  const retired = new Set(
    state.sessions.filter((s) => String(s.kind) === "legacy").map((s) => s.id),
  );
  if (!retired.size) return state;
  const sessions = state.sessions.filter((s) => !retired.has(s.id));
  return {
    ...state,
    sessions,
    memory: sessions.length ? state.memory : emptyLearning().memory,
  };
}
