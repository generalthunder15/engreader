import * as learning from "../../services/learning";
import { optionLabel } from "../../core/text";
import * as store from "../../services/storage";
import { placeSelectionMenu } from "../../core/selection-menu";
import * as audio from "../../services/audio";
import { lookup } from "../../services/dictionary";
import { explain, detail, ask } from "../../services/ai";
import {
  AI_BOOK,
  Session,
  canStart,
  closed,
  phaseLabel,
  sessionSteps,
  unresolved,
} from "../../core/learning";
import { Definition, Detail, UIEvent } from "../../core/models";
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
    headerTitle: "学习",
    navTop: 24,
    navHeight: 44,
    navRight: 110,
    steps: [] as ReturnType<typeof sessionSteps>,
    sessions: [] as { id: string; title: string; label: string }[],
    sessionIndex: 0,
    sidebarOpen: false,
    current: null as SessionView | null,
    label: "",
    canNew: false,
    hasAssessment: false,
    text: "",
    answer: "",
    selectedOption: "",
    busy: false,
    error: "",
    progress: "",
    readonly: false,
    remaining: 0,
    hasOlder: false,
    historyPage: 0,
    selectedWord: "",
    wordDefinition: null as Definition | null,
    wordPanel: false,
    wordTab: "translation",
    wordDetail: null as Detail | null,
    wordQuestion: "",
    wordAnswer: "",
    wordMenuStyle: "",
    wordMenuSide: "below",
    wordArrow: 18,
    wordPlaying: false,
    wordError: "",
    wordBusy: false,
  },
  selected: "",
  alive: true,
  wordRequest: 0,
  closeWord() {
    this.wordRequest++;
    audio.stop();
    this.setData({ selectedWord: "", wordBusy: false, wordPanel: false, wordPlaying: false });
  },
  onPageScroll() { if (!this.data.wordPanel) this.closeWord(); },
  selectWord(e: WechatMiniprogram.CustomEvent<{ word: string; y: number; x: number }>) {
    this.closeWord();
    const window = wx.getWindowInfo();
    const width = Math.min(264, window.windowWidth - 24);
    const position = placeSelectionMenu([{ left: e.detail.x, right: e.detail.x, top: e.detail.y - 12, bottom: e.detail.y + 12 }],
      { width, height: 66 }, { width: window.windowWidth, top: 12, bottom: window.windowHeight - 90 });
    if (!position) return;
    this.setData({ selectedWord: e.detail.word, wordDefinition: null, wordDetail: null, wordQuestion: "", wordAnswer: "", wordError: "",
      wordMenuStyle: `left:${position.left}px;top:${position.top}px;width:${width}px;`,
      wordMenuSide: position.side, wordArrow: position.arrow });
  },
  async playWord() {
    if (this.data.wordPlaying) { audio.stop(); this.setData({ wordPlaying: false }); return; }
    const ticket = this.wordRequest;
    this.setData({ wordPlaying: true });
    try { await audio.speak(this.data.selectedWord); } catch (error) { fail(error); }
    finally { if (this.alive && ticket === this.wordRequest) this.setData({ wordPlaying: false }); }
  },
  async translateWord(force: unknown = false) {
    if (this.data.wordBusy || !this.data.selectedWord) return;
    const word = this.data.selectedWord;
    const ticket = ++this.wordRequest;
    this.setData({ wordPanel: true, wordTab: "translation", wordBusy: true, wordError: "" });
    try {
      const definition = force === true ? await explain(word, true) : await lookup(word).catch(() => explain(word, true));
      if (!this.alive || ticket !== this.wordRequest) return;
      store.addVocab({ word: word.toLowerCase(), translation: definition.translation,
        phonetic: definition.phonetic || "", pos: definition.pos || "",
        bookId: AI_BOOK, chapterId: this.data.current?.articleId || "",
        fromBook: "AI 学习", fromChapter: this.data.current?.title || "AI 对话", createdAt: Date.now() });
      this.setData({ wordDefinition: definition });
    } catch (error) {
      if (this.alive && ticket === this.wordRequest)
        this.setData({ wordError: error instanceof Error ? error.message : "翻译失败，请点击重试" });
    } finally {
      if (this.alive && ticket === this.wordRequest) this.setData({ wordBusy: false });
    }
  },
  async wordTab(e: UIEvent) {
    if (this.data.wordBusy) return;
    const tab = data(e, "tab");
    if (tab === "translation") { await this.translateWord(); return; }
    this.setData({ wordPanel: true, wordTab: tab, wordError: "" });
    if (tab !== "detail" || this.data.wordDetail) return;
    const ticket = ++this.wordRequest;
    this.setData({ wordBusy: true });
    try {
      const result = await detail(this.data.selectedWord);
      if (this.alive && ticket === this.wordRequest) this.setData({ wordDetail: result });
    } catch (error) {
      if (this.alive && ticket === this.wordRequest) this.setData({ wordError: error instanceof Error ? error.message : "拆解失败，请重试" });
    } finally {
      if (this.alive && ticket === this.wordRequest) this.setData({ wordBusy: false });
    }
  },
  wordQuestionInput(e: UIEvent) { this.setData({ wordQuestion: input(e) }); },
  async askWord() {
    if (this.data.wordBusy || !this.data.wordQuestion.trim()) return;
    const ticket = ++this.wordRequest;
    this.setData({ wordBusy: true, wordError: "", wordAnswer: "" });
    try {
      const answer = await ask(this.data.selectedWord, this.data.wordQuestion.trim());
      if (this.alive && ticket === this.wordRequest) this.setData({ wordAnswer: answer });
    } catch (error) {
      if (this.alive && ticket === this.wordRequest) this.setData({ wordError: error instanceof Error ? error.message : "提问失败，请重试" });
    } finally {
      if (this.alive && ticket === this.wordRequest) this.setData({ wordBusy: false });
    }
  },
  onLoad() { this.measureHeader(); },
  onResize() { this.measureHeader(); },
  measureHeader() {
    const info = wx.getWindowInfo();
    const capsule = wx.getMenuButtonBoundingClientRect();
    const top = info.statusBarHeight || 24;
    this.setData({ navTop: top, navHeight: capsule.height ? (capsule.top - top) * 2 + capsule.height : 44,
      navRight: capsule.left > 0 ? info.windowWidth - capsule.left + 12 : 110 });
  },
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
      this.setData({ historyPage: 0 });
      this.refresh(true);
      if (
        this.data.current?.phase === "reading" &&
        store.chapter(AI_BOOK, this.data.current.articleId)?.quizDone
      ) {
        learning.unlockExam(this.data.current.id);
        this.refresh(true);
      }
      if (this.data.current?.phase === "exam-generating" && !learning.isBusy(this.selected)) void this.advance();
    } catch (error) {
      fail(error);
    }
  },
  onHide() {
    this.closeSidebar();
    this.closeWord();
    this.alive = false;
  },
  onUnload() {
    this.wordRequest++;
    this.alive = false;
  },
  refresh(scrollToBottom = false) {
    this.closeWord();
    const state = learning.load();
    if (!state.sessions.some((s) => s.id === this.selected))
      this.selected = state.sessions[state.sessions.length - 1]?.id || "";
    const selected = state.sessions.find((s) => s.id === this.selected) || null;
    const messages = selected?.messages.filter(m => !m.notice && !m.articleId) || [];
    const end = Math.max(0, messages.length - this.data.historyPage * 20);
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
          messages: messages.slice(Math.max(0, end - 20), end).map(message => ({
            ...message,
            question: message.question ? {
              ...message.question,
              options: message.question.options?.map(optionLabel),
            } : undefined,
          })),
          submitted: !!selected.attempt,
        }
      : null;
    this.setData({
      current,
      headerTitle: selected ? selected.kind === "assessment" ? "水平测评" : `第 ${selected.number} 课` : "学习",
      steps: sessionSteps(selected),
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
    }, () => {
      if (scrollToBottom && this.alive) {
        wx.pageScrollTo({ scrollTop: 10000000, duration: 0 });
      }
    });
  },
  openSidebar() { this.closeWord(); this.setData({ sidebarOpen: true }); },
  closeSidebar() { this.setData({ sidebarOpen: false }); },
  stopSidebarTouch() {},
  select(e: UIEvent) {
    if (this.data.busy) return;
    const selected = this.data.sessions[Number(data(e, "index"))];
    if (!selected) return;
    this.selected = selected.id;
    this.closeSidebar();
    this.setData({ text: "", answer: "", selectedOption: "", error: "", historyPage: 0 });
    this.refresh(true);
  },
  older() {
    this.setData({ historyPage: this.data.historyPage + 1 });
    this.refresh();
  },
  latest() {
    this.setData({ historyPage: 0 });
    this.refresh(true);
  },
  start() {
    try {
      this.selected = learning.createAssessment();
      this.closeSidebar();
      this.refresh();
    } catch (error) {
      fail(error);
    }
  },
  async newLesson() {
    if (this.data.busy) return;
    try {
      this.selected = learning.createLesson();
      this.closeSidebar();
      this.setData({ text: "", answer: "", selectedOption: "", error: "", historyPage: 0 });
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
        learning.unlockExam(sid);
      s = learning.session(sid);
      if (
        ["assessment", "remediation"].includes(s.phase) &&
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
  chooseOption(e: UIEvent) {
    if (!this.data.busy) this.setData({ selectedOption: data(e, "option") });
  },
  async answerQuestion() {
    const choice = this.data.current?.pending?.type === "choice";
    const text = choice ? this.data.selectedOption : this.data.answer.trim();
    const supplement = choice ? this.data.answer.trim() : "";
    if (!text) return;
    const sid = this.selected;
    await this.operate(async () => {
      await learning.continueConversation(sid, text, true, supplement);
      this.setData({ answer: "", selectedOption: "" });
      const s = learning.session(sid);
      if (this.alive && ["assessment", "remediation"].includes(s.phase) && !s.pending) {
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
