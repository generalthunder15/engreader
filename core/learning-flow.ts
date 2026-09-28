import type { Session, Phase } from "./learning";

export const PAPER = {
  readingQuestions: 5,
  clozeQuestions: 10,
  translationQuestions: 4,
  clozeMaterialStep: 6,
  translationStartStep: 17,
  readyStep: 21,
  totalQuestions: 19,
} as const;

const transitions: Partial<Record<Phase, readonly Phase[]>> = {
  intro: ["assessment"],
  assessment: ["archived"],
  generating: ["exam-generating"],
  "exam-generating": ["reading"],
  reading: ["exam"],
  exam: ["grading"],
  grading: ["remediation", "complete"],
  remediation: ["complete"],
};

/** The AI provides content; only application rules may advance the course. */
export function transition(s: Session, next: Phase): void {
  const assessmentPhases: Phase[] = ["intro", "assessment", "archived"];
  if (
    (s.kind === "assessment") !== assessmentPhases.includes(s.phase) ||
    (s.kind === "assessment") !== assessmentPhases.includes(next) ||
    !transitions[s.phase]?.includes(next)
  )
    throw new Error(`不能从 ${s.phase} 进入 ${next}`);
  s.phase = next;
}
