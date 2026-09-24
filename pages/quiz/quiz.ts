import * as store from "../../services/storage";
import * as audio from "../../services/audio";
import { fillMeanings } from "../../services/ai";
import { offline } from "../../services/dictionary";
import { Quiz } from "../../core/quiz";
import { UIEvent, Word } from "../../core/models";
import { bind } from "../../services/theme";
import { data, navigate, fail, toast } from "../../services/ui";
Page({
  data: {
    themeStyle: "",
    phase: "idle",
    busy: false,
    title: "每天一点，离熟练更近",
    current: null as ReturnType<Quiz["next"]>,
    result: "",
    picked: -1,
    total: 0,
    remaining: 0,
    right: 0,
    wrong: 0,
    passed: 0,
    progress: 0,
    chapterMode: false,
    skipped: 0,
  },
  session: null as Quiz | null,
  timer: null as ReturnType<typeof setTimeout> | null,
  target: { bookId: "", chapterId: "" },
  active: false,
  run: 0,
  onShow() {
    this.active = true;
    bind(this, 0);
    const target = store.read<{ bookId: string; chapterId: string } | null>(
      "quiz_target",
      null,
    );
    if (target) {
      wx.removeStorageSync("quiz_target");
      this.target = target;
      this.session = null;
      this.setData({
        phase: "idle",
        chapterMode: !!target.chapterId,
        title:
          target.chapterId ? store.chapter(target.bookId, target.chapterId)?.title || "本章闯关" : "每天一点，离熟练更近",
      });
      void this.start();
    } else if (this.data.result && this.session) this.next();
  },
  async start() {
    if (this.data.busy) return;
    const run = ++this.run;
    this.clearTimer();
    this.setData({ busy: true });
    try {
      const ch = this.target.chapterId
        ? store.chapter(this.target.bookId, this.target.chapterId)
        : null;
      let words: Word[] = this.target.chapterId
        ? ch?.words || []
        : store
            .vocab()
            .slice(0, store.settings().quizCount)
            .map((v) => ({
              word: v.word,
              meaning: v.translation || v.meaning || "",
            }));
      words = words.map((w) => ({
        ...w,
        meaning:
          w.meaning ||
          (store.settings().localFallback
            ? offline(w.word)?.translation
            : "") ||
          "",
      }));
      if (words.some((w) => !w.meaning)) {
        try {
          words = await fillMeanings(words);
        } catch {
          if (this.active) toast("部分释义未补全，将跳过这些词");
        }
      }
      if (run !== this.run || !this.active) return;
      if (ch) store.saveChapter({ ...ch, words });
      else {
        const vocab = store
          .vocab()
          .map((v) => ({
            ...v,
            translation:
              v.translation ||
              words.find((w) => w.word === v.word)?.meaning ||
              "",
          }));
        store.write("vocab", vocab);
      }
      this.session = new Quiz(words);
      this.setData({
        phase: this.session.words.length ? "running" : "empty",
        total: this.session.words.length,
        right: 0,
        wrong: 0,
        passed: 0,
        skipped: words.length - this.session.words.length,
      });
      this.next();
    } catch (error) {
      if (this.active) fail(error);
    } finally {
      if (run === this.run) this.setData({ busy: false });
    }
  },
  next() {
    if (!this.session || !this.session.words.length) return;
    const current = this.session.next();
    if (!current && this.target.chapterId && this.data.skipped === 0) {
      try {
        store.completeChapter(this.target.bookId, this.target.chapterId);
      } catch (error) {
        fail(error);
      }
    }
    this.setData({
      current,
      phase: current ? "running" : "done",
      result: "",
      picked: -1,
      remaining: this.session.remaining,
      right: this.session.right,
      wrong: this.session.wrong,
      passed: this.session.passed,
      progress: Math.round(
        ((this.session.words.length - this.session.remaining) /
          this.session.words.length) *
          100,
      ),
    });
    if (current && store.settings().autoPlay)
      void audio.speak(current.word).catch(() => {});
  },
  pick(e: UIEvent) {
    if (!this.session || !this.data.current || this.data.result) return;
    const picked = Number(data(e, "index"));
    const correct = picked === this.data.current.answer;
    this.session.answer(correct);
    this.setData({ picked, result: correct ? "right" : "wrong" });
    this.timer = setTimeout(
      () => {
        if (this.active) this.next();
      },
      correct ? 500 : 1400,
    );
  },
  speak() {
    if (this.data.current) void audio.speak(this.data.current.word).catch(fail);
  },
  vocab() {
    navigate("vocab");
  },
  normal() {
    this.run++;
    this.clearTimer();
    audio.stop();
    this.session = null;
    this.target = { bookId: "", chapterId: "" };
    this.setData({
      busy: false,
      current: null,
      result: '',
      phase: "idle",
      chapterMode: false,
      title: "每天一点，离熟练更近",
    });
  },
  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  },
  onHide() {
    this.active = false;
    this.run++;
    this.setData({ busy: false });
    this.clearTimer();
    audio.stop();
  },
  onUnload() {
    this.active = false;
    this.run++;
    this.clearTimer();
    audio.stop();
  },
});
