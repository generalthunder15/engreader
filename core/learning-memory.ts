import type { Exercise, Session, Memory } from "./learning";

export interface Supplement {
  question: string;
  request: string;
}
export interface LearningRound {
  question: Pick<Exercise, "id" | "type" | "title" | "material" | "options">;
  answer: string;
  supplement: Supplement;
  correct: boolean | null;
}
export const visibleQuestion = (q: Exercise): LearningRound["question"] => ({
  id: q.id,
  type: q.type,
  title: q.title,
  material: q.material || "",
  options: q.options,
});

/** UI history is never sent back wholesale: explanations and irrelevant remarks stay local. */
export function rounds(s: Session): LearningRound[] {
  const rows = new Map<string, LearningRound>();
  for (const e of [...s.assessmentEvidence, ...s.evidence]) {
    rows.set(e.question.id, {
      question: visibleQuestion(e.question),
      answer: e.answer.split("\n补充说明：")[0],
      supplement: { question: "", request: "" },
      correct: e.correct,
    });
  }
  const current = s.rounds || [];
  const ids = new Set(current.map((row) => row.question.id));
  return [...rows.values()]
    .filter((row) => !ids.has(row.question.id))
    .concat(current);
}

export function shortMemory(s: Session, budget = 14000) {
  const all = rounds(s);
  const recent: LearningRound[] = [];
  let size = 0;
  for (const row of [...all].reverse()) {
    const length = JSON.stringify(row).length;
    if (size + length > budget) break;
    recent.unshift(row);
    size += length;
  }
  const older = all.slice(0, all.length - recent.length);
  const requests = [
    ...all.map((r) => r.supplement.request),
    ...(s.requests || []),
  ].filter(Boolean);
  return {
    introduction:
      s.introduction ||
      (s.kind === "assessment"
        ? s.messages.find((m) => m.role === "user" && !m.answerTo)?.content
        : "") ||
      "",
    // Requirements remain pinned even when their original question leaves the recent window.
    requirements: requests.filter(
      (value, index) => requests.lastIndexOf(value) === index,
    ),
    earlierQuestions: older.map((r) => ({
      id: r.question.id,
      title: r.question.title,
      material: r.question.material?.slice(0, 300),
      options: r.question.options,
      answer: r.answer,
      correct: r.correct,
    })),
    rounds: recent,
  };
}

export function archiveInput(s: Session) {
  return {
    sessionId: s.id,
    title: s.title,
    date: new Date(s.createdAt).toISOString().slice(0, 10),
    introduction: shortMemory(s).introduction,
    articleSummary: s.summary,
    requirements: shortMemory(s).requirements,
    rounds: rounds(s),
    exam: s.sections.flatMap((section) =>
      section.questions.map((q) => ({
        question: visibleQuestion(q),
        answer: s.attempt?.answers[q.id] || "",
        correct: s.attempt?.grades.find((g) => g.id === q.id)?.correct ?? null,
      })),
    ),
  };
}

/** One-time migration preserves explicit profile and closed-course summaries, not mastery claims. */
export function migrateMemory(raw: unknown, sessions: Session[]): Memory {
  const old = (raw || {}) as Record<string, unknown>;
  if (typeof old.markdown === "string") return raw as Memory;
  if (
    typeof old.profile !== "string" ||
    !Array.isArray(old.mastered) ||
    !Array.isArray(old.weak) ||
    !Array.isArray(old.articles)
  )
    throw new Error("长期记忆格式不正确");
  const profile = typeof old.profile === "string" ? old.profile.trim() : "";
  const ended = sessions.filter(
    (s) => s.phase === "complete" || s.phase === "archived",
  );
  const summaries = ended
    .filter((s) => s.summary)
    .map((s) => `- ${s.title}：${s.summary}`);
  return {
    markdown:
      profile || summaries.length
        ? [
            "# 用户记忆",
            profile ? "\n## 用户自述（旧版迁移）\n" + profile : "",
            summaries.length
              ? "\n## 已结束的学习经历\n" + summaries.join("\n")
              : "",
          ]
            .filter(Boolean)
            .join("\n")
        : "",
    revision: 0,
    updatedAt: 0,
    archivedSessions: ended.map((s) => s.id),
  };
}
