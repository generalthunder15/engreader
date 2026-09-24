import * as store from "../../services/storage";
import { coach } from "../../services/ai";
import { Question, Study, UIEvent, record } from "../../core/models";
import { commitReply } from "../../core/study";
import { bind } from "../../services/theme";
import { data, input, navigate, confirm, fail, toast } from "../../services/ui";
interface Bubble {
  id: string;
  role: string;
  text: string;
  question: Question | null;
  actionable: boolean;
}
Page({
  data: {
    themeStyle: "",
    state: store.emptyStudy(),
    bubbles: [] as Bubble[],
    input: "",
    sending: false,
    done: 0,
    scrollInto: "",
    error: "",
    answered: 0,
  },
  active: true,
  generation: 0,
  onShow() {
    this.active = true;
    bind(this, 2);
    this.refresh();
  },
  onUnload() {
    this.active = false;
    this.generation++;
  },
  refresh() {
    const state = store.study();
    const messages = state.qa?.messages || [];
    const bubbles: Bubble[] = messages.map((m, i) => {
      let text = m.content;
      let question: Question | null = null;
      if (m.role === "assistant") {
        try {
          const r = record(JSON.parse(m.content));
          text = String(r.reply || "");
          question = (r.question as Question) || null;
        } catch {
          /* 兼容旧版纯文本 */
        }
      }
      return {
        id: "m" + i,
        role: m.role,
        text,
        question,
        actionable:
          i === messages.length - 1 && ["assess", "qa"].includes(state.phase),
      };
    });
    this.setData({
      state,
      bubbles,
      done: state.plan?.chapters.filter((c) => c.done).length || 0,
      scrollInto: bubbles[bubbles.length - 1]?.id || "",
      answered: state.assess?.asked || 0,
    });
  },
  async start() {
    if (this.data.sending) return;
    const state: Study = {
      ...store.emptyStudy(),
      phase: "assess",
      createdAt: Date.now(),
      assess: { total: 24, asked: 0 },
      qa: { messages: [] },
    };
    try {
      store.write("study_state", state);
      this.refresh();
      await this.send("请开始摸底，出第一道题。", false);
    } catch (error) {
      fail(error);
    }
  },
  input(e: UIEvent) {
    this.setData({ input: input(e) });
  },
  async submit() {
    const text = this.data.input.trim();
    if (!text || !["assess", "qa"].includes(this.data.state.phase)) return;
    if (await this.send(text, true)) this.setData({ input: "" });
  },
  async pick(e: UIEvent) {
    if (
      data(e, "id") !== this.data.bubbles[this.data.bubbles.length - 1]?.id ||
      !["assess", "qa"].includes(this.data.state.phase)
    )
      return;
    await this.send(data(e, "text"), true);
  },
  async send(text: string, answer: boolean): Promise<boolean> {
    if (this.data.sending) return false;
    const ticket = ++this.generation;
    const state = store.study();
    const answered =
      (state.assess?.asked || 0) + (answer && state.phase === "assess" ? 1 : 0);
    this.setData({ sending: true, error: "" });
    try {
      const result = await coach(state, text, answered);
      if (!this.active || ticket !== this.generation) return false;
      if (store.study().createdAt !== state.createdAt) { this.refresh(); return false; }
      store.write("study_state", commitReply(state, text, result, answered));
      this.refresh();
      return true;
    } catch (error) {
      if (this.active && ticket === this.generation)
        this.setData({
          error: error instanceof Error ? error.message : "请求失败，请重试",
        });
      return false;
    } finally {
      if (this.active && ticket === this.generation)
        this.setData({ sending: false });
    }
  },
  retry() {
    if (!this.data.bubbles.length)
      void this.send("请开始摸底，出第一道题。", false);
    else toast("请重新选择答案或发送输入内容");
  },
  read(e: UIEvent) {
    navigate("reader", {
      bookId: data(e, "book"),
      chapterId: data(e, "chapter"),
    });
  },
  quiz(e: UIEvent) {
    store.write("quiz_target", {
      bookId: data(e, "book"),
      chapterId: data(e, "chapter"),
    });
    wx.switchTab({ url: "/pages/quiz/quiz" });
  },
  async qa() {
    const state = store.study();
    if (
      !state.plan?.chapters.length ||
      !state.plan.chapters.every((c) => c.done)
    )
      return toast("请先完成计划中的章节闯关");
    try {
      store.write("study_state", { ...state, phase: "qa" });
      this.refresh();
      await this.send("已完成阅读和闯关，请出第一道理解题。", false);
    } catch (error) {
      fail(error);
    }
  },
  async reset() {
    if (
      !(await confirm(
        "重新开始学习",
        "将清空测评、计划和教练对话。书籍与收藏保留。",
      ))
    )
      return;
    this.generation++;
    try {
      store.write("study_state", store.emptyStudy());
      this.setData({ sending: false, error: "", input: "" });
      this.refresh();
    } catch (error) {
      fail(error);
    }
  },
});
