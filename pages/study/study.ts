import * as learning from "../../services/learning";
import * as store from "../../services/storage";
import {
  AI_BOOK,
  Session,
  canStart,
  closed,
  phaseLabel,
  unresolved,
} from "../../core/learning";
import { UIEvent } from "../../core/models";
import { bind } from "../../services/theme";
import { data, input, navigate, fail } from "../../services/ui";
type SessionView = Pick<
  Session,
  | "id"
  | "kind"
  | "title"
  | "phase"
  | "articleId"
  | "examId"
  | "generationStep"
  | "assessed"
  | "pending"
  | "messages"
> & { submitted: boolean };
Page({
  data: {
    themeStyle: "",
    sessions: [] as { id: string; title: string; label: string }[],
    sessionIndex: 0,
    current: null as SessionView | null,
    label: "",
    canNew: false,
    hasAssessment: false,
    text: "",
    answer: "",
    busy: false,
    error: "",
    progress: "",
    readonly: false,
    remaining: 0,
    hasOlder: false,
    historyPage: 0,
  },
  selected: "",
  alive: true,
  onShow() {
    this.alive = true;
    bind(this, 2);
    try {
      learning.initialize();
      const requested = store.read("open_learning_session", "");
      if (requested) {
        this.selected = requested;
        wx.removeStorageSync("open_learning_session");
      }
      this.refresh();
      if (
        this.data.current?.phase === "reading" &&
        store.chapter(AI_BOOK, this.data.current.articleId)?.quizDone
      ) {
        learning.unlockTeaching(this.data.current.id);
        this.refresh();
      }
    } catch (error) {
      fail(error);
    }
  },
  onHide() {
    this.alive = false;
  },
  onUnload() {
    this.alive = false;
  },
  refresh() {
    const state = learning.load();
    if (!state.sessions.some((s) => s.id === this.selected))
      this.selected = state.sessions[state.sessions.length - 1]?.id || "";
    const selected = state.sessions.find((s) => s.id === this.selected) || null;
    const end = selected
      ? Math.max(0, selected.messages.length - this.data.historyPage * 20)
      : 0;
    const current: SessionView | null = selected
      ? {
          id: selected.id,
          kind: selected.kind,
          title: selected.title,
          phase: selected.phase,
          articleId: selected.articleId,
          examId: selected.examId,
          generationStep: selected.generationStep,
          assessed: selected.assessed,
          pending: selected.pending,
          messages: selected.messages.slice(Math.max(0, end - 20), end),
          submitted: !!selected.attempt,
        }
      : null;
    this.setData({
      current,
      hasOlder: end > 20,
      sessionIndex: Math.max(0, state.sessions.length - 1 - state.sessions.findIndex((s) => s.id === this.selected)),
      sessions: [...state.sessions]
        .reverse()
        .map((s) => ({ id: s.id, title: s.title, label: phaseLabel[s.phase] })),
      canNew: canStart(state),
      hasAssessment: state.sessions.some((s) => s.kind === "assessment"),
      label: current ? phaseLabel[current.phase] : "",
      readonly: !!selected && closed(selected),
      remaining: selected ? unresolved(selected).length : 0,
    });
  },
  select(e: UIEvent) {
    if (this.data.busy) return;
    const selected = this.data.sessions[Number(input(e))];
    if (!selected) return;
    this.selected = selected.id;
    this.setData({ text: "", answer: "", error: "", historyPage: 0 });
    this.refresh();
  },
  older() {
    this.setData({ historyPage: this.data.historyPage + 1 });
    this.refresh();
  },
  latest() {
    this.setData({ historyPage: 0 });
    this.refresh();
  },
  start() {
    try {
      this.selected = learning.createAssessment();
      this.refresh();
    } catch (error) {
      fail(error);
    }
  },
  async newLesson() {
    if (this.data.busy) return;
    try {
      this.selected = learning.createLesson();
      this.setData({ text: "", answer: "", error: "", historyPage: 0 });
      this.refresh();
      await this.advance();
    } catch (error) {
      fail(error);
    }
  },
  text(e: UIEvent) {
    this.setData({ text: input(e) });
  },
  answer(e: UIEvent) {
    this.setData({ answer: input(e) });
  },
  async operate(work: () => Promise<void>) {
    if (this.data.busy) return;
    this.setData({ busy: true, error: "", progress: "" });
    let success = false;
    try {
      await work();
      success = true;
    } catch (error) {
      if (this.alive)
        this.setData({
          error: error instanceof Error ? error.message : "操作失败，请重试",
        });
    } finally {
      this.setData({ busy: false });
      if (this.alive) {
        this.setData({ historyPage: 0 });
        this.refresh();
        if (success) wx.pageScrollTo({ scrollTop: 10000000, duration: 200 });
        if (success && this.data.current?.phase === "exam-generating")
          void this.advance();
      }
    }
  },
  async advance() {
    const sid = this.selected;
    await this.operate(async () => {
      let s = learning.session(sid);
      const initialPhase = s.phase;
      while (
        this.alive &&
        ["generating", "exam-generating"].includes(s.phase)
      ) {
        this.setData({ progress: learning.generationLabel(s) });
        await learning.generateStep(sid);
        s = learning.session(sid);
        if (this.alive) this.refresh();
      }
      if (!this.alive) return;
      if (s.phase === "grading") await learning.gradeExam(sid);
      else if (s.phase === "reading" && initialPhase === "reading")
        learning.unlockTeaching(sid);
      s = learning.session(sid);
      if (
        ["assessment", "teaching", "remediation"].includes(s.phase) &&
        !s.pending
      )
        await learning.continueConversation(sid);
    });
  },
  async send() {
    const sid = this.selected,
      text = this.data.text.trim();
    if (!text) return;
    await this.operate(async () => {
      if (learning.session(sid).phase === "intro")
        await learning.beginAssessment(sid, text);
      else await learning.continueConversation(sid, text);
      this.setData({ text: "" });
    });
  },
  async answerQuestion(e?: UIEvent) {
    const text = (e && data(e, "option")) || this.data.answer.trim();
    if (!text) return;
    const sid = this.selected;
    await this.operate(async () => {
      await learning.continueConversation(sid, text, true);
      this.setData({ answer: "" });
      const s = learning.session(sid);
      if (this.alive && !closed(s)) {
        this.refresh();
        await learning.continueConversation(sid);
      }
    });
  },
  read() {
    const s = this.data.current;
    if (s) navigate("reader", { bookId: AI_BOOK, chapterId: s.articleId });
  },
  exam() {
    const s = this.data.current;
    if (s) navigate("reader", { bookId: AI_BOOK, chapterId: s.examId });
  },
  quiz() {
    const s = this.data.current;
    if (!s) return;
    store.write("quiz_target", { bookId: AI_BOOK, chapterId: s.articleId });
    wx.switchTab({ url: "/pages/quiz/quiz" });
  },
});
