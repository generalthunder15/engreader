import * as store from "../../services/storage";
import * as learning from "../../services/learning";
import { Chapter, UIEvent } from "../../core/models";
import { Attempt, ExamSection, Grade } from "../../core/learning";
import { data, input } from "../../services/ui";
Component({
  properties: { bookId: String, chapterId: String },
  data: {
    title: "",
    sections: [] as ExamSection[],
    answers: {} as Record<string, string>,
    grades: {} as Record<string, Grade>,
    submitted: false,
    graded: false,
    busy: false,
    error: "",
    answered: 0,
    total: 0,
    correct: 0,
    sessionId: "",
  },
  observers: {
    "bookId, chapterId": function () {
      this.refresh();
    },
  },
  lifetimes: {
    attached() {
      this.refresh();
    },
  },
  pageLifetimes: {
    show() {
      this.refresh();
    },
  },
  methods: {
    key() {
      return "exam_draft_" + this.properties.chapterId;
    },
    current(): Chapter | null {
      return store.chapter(this.properties.bookId, this.properties.chapterId);
    },
    refresh() {
      const ch = this.current();
      if (!ch) return;
      const attempt = ch.sessionId
        ? learning.session(ch.sessionId).attempt
        : store.read<Attempt | null>("exam_attempt_" + ch.id, null);
      const answers =
        attempt?.answers || store.read<Record<string, string>>(this.key(), {});
      const sections = ch.sections || [],
        questions = sections.flatMap((s) => s.questions);
      const grades: Record<string, Grade> = {};
      attempt?.grades.forEach((g) => {
        grades[g.id] = g;
      });
      this.setData({
        title: ch.title,
        sections,
        answers,
        grades,
        submitted: !!attempt,
        graded: !!attempt?.grades.length,
        total: questions.length,
        answered: questions.filter((q) => answers[q.id]?.trim()).length,
        correct: attempt?.grades.filter((g) => g.correct).length || 0,
        sessionId: ch.sessionId || "",
      });
    },
    saveAnswer(e: UIEvent, value: string) {
      if (this.data.submitted || this.data.busy) return;
      const qid = data(e, "id");
      if (
        !this.data.sections.some((s) => s.questions.some((q) => q.id === qid))
      )
        return;
      const answers = { ...this.data.answers, [qid]: value };
      try {
        store.write(this.key(), answers);
        this.setData({
          answers,
          answered: this.data.sections
            .flatMap((s) => s.questions)
            .filter((q) => answers[q.id]?.trim()).length,
          error: "",
        });
      } catch (error) {
        this.setData({
          error: error instanceof Error ? error.message : "答案保存失败",
        });
      }
    },
    pick(e: UIEvent) {
      this.saveAnswer(e, data(e, "value"));
    },
    fill(e: UIEvent) {
      this.saveAnswer(e, input(e));
    },
    async submit() {
      if (this.data.busy || this.data.graded) return;
      this.setData({ busy: true, error: "" });
      try {
        const ch = this.current();
        if (!ch) throw new Error("章节不存在");
        if (!this.data.submitted) {
          if (this.data.answered !== this.data.total || !this.data.total)
            throw new Error("请完成所有题目再提交");
          if (ch.sessionId)
            learning.submitExam(ch.sessionId, this.data.answers);
          else
            store.write("exam_attempt_" + ch.id, {
              answers: { ...this.data.answers },
              submittedAt: Date.now(),
              grades: [],
            });
          this.refresh();
        }
        if (ch.sessionId) await learning.gradeExam(ch.sessionId);
        else {
          const attempt = store.read<Attempt>("exam_attempt_" + ch.id, {
            answers: {},
            submittedAt: 0,
            grades: [],
          });
          const graded = await learning.gradeStandalone(
            ch.sections || [],
            attempt,
          );
          const latest = store.chapter(ch.bookId, ch.id);
          const savedAttempt = store.read<Attempt | null>(
            "exam_attempt_" + ch.id,
            null,
          );
          if (
            !latest ||
            JSON.stringify(latest.sections) !== JSON.stringify(ch.sections) ||
            savedAttempt?.submittedAt !== attempt.submittedAt
          )
            throw new Error("试卷已更新，本次旧批改结果不会保存");
          store.write("exam_attempt_" + ch.id, graded);
        }
        this.refresh();
      } catch (error) {
        this.setData({
          error: error instanceof Error ? error.message : "批改失败，请重试",
        });
      } finally {
        this.setData({ busy: false });
      }
    },
    study() {
      store.write("open_learning_session", this.data.sessionId);
      wx.switchTab({ url: "/pages/study/study" });
    },
  },
});
