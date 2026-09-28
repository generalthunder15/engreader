import { PAPER, transition } from "../core/learning-flow";
import * as store from "./storage";
import { session, commit } from "./learning-repository";
import { learningPrompts as prompts } from "./learning-prompts";
import {
  AI_BOOK,
  Attempt,
  closed,
  complete,
  unresolved,
  parseGrades,
} from "../core/learning";
import { exclusive, askJSON, add } from "./learning-runtime";
import { summarizeClosed } from "./learning-archive";
export function submitExam(sid: string, answers: Record<string, string>): void {
  const s = session(sid);
  if (
    s.phase !== "exam" ||
    s.attempt ||
    !store.chapter(AI_BOOK, s.articleId)?.quizDone
  )
    throw new Error("试卷已提交或尚未准备好");
  const questions = s.sections.flatMap((v) => v.questions);
  if (
    questions.length !== PAPER.totalQuestions ||
    s.generationStep !== PAPER.readyStep
  )
    throw new Error("试卷尚未完整");
  const snapshot: Record<string, string> = {};
  for (const q of questions) {
    snapshot[q.id] = answers[q.id]?.trim() || "";
  }
  s.attempt = { answers: snapshot, submittedAt: Date.now(), grades: [] };
  transition(s, "grading");
  commit(s);
}
export async function gradeExam(sid: string): Promise<void> {
  return exclusive(sid, async () => {
    const s = session(sid);
    if (s.phase !== "grading" || !s.attempt)
      throw new Error("当前没有待批改试卷");
    const r = await askJSON(prompts.examGrade, {
      sections: s.sections,
      answers: s.attempt.answers,
    });
    s.attempt.grades = parseGrades(
      r,
      s.sections.flatMap((v) => v.questions),
    );
    s.attempt.grades = lockBlankGrades(s.attempt.grades, s.attempt.answers);
    // Only post-exam evidence may discharge exam mistakes.
    s.evidence = [];
    transition(s, complete(s) ? "complete" : "remediation");
    add(
      s,
      "assistant",
      closed(s)
        ? "试卷全部答对，本课完成！你可以主动开启下一课。"
        : `批改完成。接下来逐个巩固 ${unresolved(s).length} 个错题知识点，答对新同类题后才能完成本课。`,
    );
    commit(s);
    if (closed(s)) await summarizeClosed(sid);
  });
}
function lockBlankGrades(
  grades: import("../core/learning").Grade[],
  answers: Record<string, string>,
) {
  return grades.map((g) =>
    answers[g.id]?.trim()
      ? g
      : { ...g, correct: false, feedback: "未作答。" + g.feedback },
  );
}
export async function gradeStandalone(
  sections: import("../core/learning").ExamSection[],
  attempt: Attempt,
): Promise<Attempt> {
  const r = await askJSON(prompts.examGrade, {
    sections,
    answers: attempt.answers,
  });
  return {
    ...attempt,
    grades: lockBlankGrades(
      parseGrades(
        r,
        sections.flatMap((v) => v.questions),
      ),
      attempt.answers,
    ),
  };
}
