import { transition } from "../core/learning-flow";
import { session, commit } from "./learning-repository";
import { learningPrompts as prompts, questionSchema } from "./learning-prompts";
import { visibleQuestion } from "../core/learning-memory";
import {
  Session,
  Exercise,
  Evidence,
  closed,
  complete,
  unresolved,
  required,
  parseExercise,
  parseGrades,
} from "../core/learning";
import { id, record } from "../core/models";
import {
  exclusive,
  askJSON,
  context,
  add,
  classifySupplement,
} from "./learning-runtime";
import { summarizeClosed } from "./learning-archive";
async function nextQuestion(
  s: Session,
  prompt: string,
  extra: unknown = {},
): Promise<Exercise> {
  const r = await askJSON(
    prompt + "\n" + prompts.quality + " 输出：" + questionSchema,
    { context: context(s), extra },
  );
  return parseExercise(r, id());
}
export async function beginAssessment(
  sid: string,
  introduction: string,
): Promise<void> {
  return exclusive(sid, async () => {
    const s = session(sid);
    if (s.phase !== "intro") throw new Error("测评已经开始");
    const text = introduction.trim();
    if (!text) throw new Error("请先介绍一下你的基础和目标");
    s.introduction = text;
    const q = await nextQuestion(s, prompts.first, { introduction: text });
    if (q.type !== "choice") throw new Error("测评需要选择题");
    add(s, "user", text);
    add(
      s,
      "assistant",
      "谢谢你的介绍。我们一次做一道题，先了解你现在的水平。",
      q,
    );
    transition(s, "assessment");
    s.pending = q;
    commit(s);
  });
}
export async function continueConversation(
  sid: string,
  input = "",
  answer = false,
  supplement = "",
): Promise<void> {
  return exclusive(sid, async () => {
    const s = session(sid);
    if (closed(s) || !["assessment", "remediation"].includes(s.phase))
      throw new Error("当前阶段不能继续对话");
    const q = s.pending;
    if (q && !answer && !input.trim()) return;
    if (answer && (!q || !input.trim())) throw new Error("请先作答");
    if (s.phase === "assessment" && q && !answer)
      throw new Error("请先回答当前测评题");
    if (answer && q) {
      if (q.type === "choice" && !["A", "B", "C", "D"].includes(input))
        throw new Error("请选择一个有效选项");
      const response =
        input + (supplement.trim() ? "\n补充说明：" + supplement.trim() : "");
      const classified = await classifySupplement(supplement);
      const raw = await askJSON(prompts.grade, {
        question: visibleQuestion(q),
        reference: { answer: q.answer },
        answer: input,
        supplement: classified,
        context: context(s),
      });
      const invalidFeedback = Array.isArray(raw.grades)
        ? record(raw.grades[0]).feedback
        : undefined;
      const grade =
        raw.validQuestion === false
          ? {
              id: q.id,
              correct: false,
              points: q.points,
              feedback:
                typeof invalidFeedback === "string" && invalidFeedback.trim()
                  ? invalidFeedback
                  : "这道题缺少必要条件或存在多个正确答案，不能公平评分。已作废，将换一道新题。",
            }
          : parseGrades(raw, [q])[0];
      s.rounds = [
        ...(s.rounds || []),
        {
          question: visibleQuestion(q),
          answer: input,
          supplement: classified,
          correct: raw.validQuestion === false ? null : grade.correct,
        },
      ];
      add(s, "user", response);
      s.messages[s.messages.length - 1].answerTo = q.id;
      add(s, "assistant", grade.feedback);
      if (raw.validQuestion === false) {
        s.pending = null;
        add(
          s,
          "assistant",
          "这道题条件不足或存在多解，已作废，不计入测评或复测成绩。接下来换一道完整的新题。",
          undefined,
          true,
        );
        commit(s);
        return;
      }
      const rows: Evidence[] = q.points.map((point) => ({
        point,
        question: q,
        answer: response,
        correct: grade.correct,
        feedback: grade.feedback,
        at: Date.now(),
      }));
      if (s.phase === "assessment") {
        s.assessmentEvidence.push(...rows);
        s.assessed++;
      } else s.evidence.push(...rows);
      s.pending = null;
      if (s.phase === "remediation" && complete(s)) {
        transition(s, "complete");
        add(
          s,
          "assistant",
          "所有错题知识点都已通过新同类题复测，本课完成。准备好后可以开启下一课。",
        );
      }
      commit(s);
      if (closed(s)) await summarizeClosed(sid);
      // Save grading before generating the next question, so retry never grades an answer twice.
      return;
    }
    if (s.phase === "assessment") {
      if (s.assessed >= 24) {
        const r = await askJSON(prompts.report, context(s));
        add(s, "assistant", required(r.report, "测评报告"));
        transition(s, "archived");
        commit(s);
        await summarizeClosed(sid);
        return;
      }
      const next = await nextQuestion(s, prompts.next);
      if (next.type !== "choice") throw new Error("测评需要选择题");
      s.pending = next;
      add(s, "assistant", `第 ${s.assessed + 1} / 24 题`, next);
      commit(s);
      return;
    }
    if (s.phase === "remediation" && !input.trim()) {
      const point = unresolved(s)[0];
      if (!point) throw new Error("没有待复测知识点");
      const next = await nextQuestion(s, prompts.remediation, {
        point,
        original: s.sections.map((section) => ({
          material: section.material,
          questions: section.questions.map(visibleQuestion),
        })),
      });
      if (
        [
          ...s.sections.flatMap((v) => v.questions),
          ...s.evidence.map((e) => e.question),
        ].some(
          (q) =>
            q.title.trim().toLowerCase() === next.title.trim().toLowerCase(),
        )
      )
        throw new Error("复测题与旧题重复，请重试");
      next.points = [point];
      s.pending = next;
      add(s, "assistant", `接下来巩固：${point}`, next);
      commit(s);
      return;
    }
    const classified = await classifySupplement(input);
    if (!classified.question && !classified.request) {
      if (input.trim()) add(s, "user", input);
      commit(s);
      return;
    }
    if (classified.request)
      s.requests = [...(s.requests || []), classified.request];
    const r = await askJSON(prompts.explain, {
      context: context(s),
      supplement: classified,
      pending: q ? visibleQuestion(q) : null,
      unresolved: unresolved(s),
    });
    if (input.trim()) add(s, "user", input);
    add(s, "assistant", required(r.reply, "讲解"));
    commit(s);
  });
}
