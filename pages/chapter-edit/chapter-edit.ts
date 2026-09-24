import * as store from "../../services/storage";
import * as ai from "../../services/ai";
import { bind } from "../../services/theme";
import { data, input, fail, toast, confirm } from "../../services/ui";
import { Chapter, UIEvent, Word, id } from "../../core/models";
import { tokenize } from "../../core/text";
import { AI_BOOK, Exercise, parseExercise } from "../../core/learning";
interface EditorQuestion {
  id: string;
  type: Exercise["type"];
  title: string;
  optionsText: string;
  answer: string;
  explanation: string;
  point: string;
  direction: "en-zh" | "zh-en";
}
interface EditorSection {
  id: string;
  title: string;
  material: string;
  questions: EditorQuestion[];
}
Page({
  data: {
    themeStyle: "",
    title: "",
    content: "",
    words: [] as Word[],
    busy: false,
    progress: "",
    editing: false,
    kind: "article",
    sections: [] as EditorSection[],
  },
  bookId: "",
  original: null as Chapter | null,
  alive: true,
  onLoad(query: Record<string, string>) {
    this.bookId = query.bookId || "";
    if (this.bookId === AI_BOOK) {
      toast("AI 课程章节由学习流程管理");
      wx.navigateBack();
      return;
    }
    this.original = store.chapter(this.bookId, query.chapterId || "");
    if (this.original)
      this.setData({
        title: this.original.title,
        content: this.original.rawText,
        words: this.original.words.map((w) => ({ ...w })),
        editing: true,
        kind: this.original.kind || "article",
        sections: (this.original.sections || []).map((s) => ({
          ...s,
          questions: s.questions.map((q) => ({
            id: q.id,
            type: q.type,
            title: q.title,
            optionsText: q.options.join("\n"),
            answer: q.answer,
            explanation: q.explanation,
            point: q.points.join("、"),
            direction: q.direction || "en-zh",
          })),
        })),
      });
  },
  onShow() {
    bind(this);
  },
  onUnload() {
    this.alive = false;
  },
  title(e: UIEvent) {
    this.setData({ title: input(e) });
  },
  kind(e: UIEvent) {
    if (!this.data.busy) this.setData({ kind: data(e, "kind") });
  },
  addSection() {
    this.setData({
      sections: [
        ...this.data.sections,
        { id: id(), title: "", material: "", questions: [] },
      ],
    });
  },
  sectionField(e: UIEvent) {
    const sections = this.data.sections,
      s = sections[Number(data(e, "section"))];
    if (!s || !["title", "material"].includes(data(e, "field"))) return;
    if (data(e, "field") === "title") s.title = input(e);
    else s.material = input(e);
    this.setData({ sections });
  },
  removeSection(e: UIEvent) {
    this.setData({
      sections: this.data.sections.filter(
        (_, i) => i !== Number(data(e, "section")),
      ),
    });
  },
  addQuestion(e: UIEvent) {
    const sections = this.data.sections,
      s = sections[Number(data(e, "section"))];
    if (!s) return;
    const type = data(e, "type") as Exercise["type"];
    s.questions.push({
      id: id(),
      type,
      title: "",
      optionsText: "",
      answer: "",
      explanation: "",
      point: "",
      direction: "en-zh",
    });
    this.setData({ sections });
  },
  questionField(e: UIEvent) {
    const sections = this.data.sections,
      q =
        sections[Number(data(e, "section"))]?.questions[
          Number(data(e, "question"))
        ];
    const field = data(e, "field");
    if (
      !q ||
      ![
        "title",
        "optionsText",
        "answer",
        "explanation",
        "point",
        "direction",
      ].includes(field)
    )
      return;
    if (field === "direction")
      q.direction = input(e) === "1" ? "zh-en" : "en-zh";
    else
      q[field as "title" | "optionsText" | "answer" | "explanation" | "point"] =
        input(e);
    this.setData({ sections });
  },
  removeQuestion(e: UIEvent) {
    const sections = this.data.sections,
      s = sections[Number(data(e, "section"))];
    if (!s) return;
    s.questions = s.questions.filter(
      (_, i) => i !== Number(data(e, "question")),
    );
    this.setData({ sections });
  },
  content(e: UIEvent) {
    this.setData({ content: input(e) });
  },
  word(e: UIEvent) {
    const words = this.data.words.map((w) => ({ ...w }));
    const row = words[Number(data(e, "index"))];
    if (!row) return;
    if (data(e, "field") === "word") row.word = input(e);
    else row.meaning = input(e);
    this.setData({ words });
  },
  addWord() {
    this.setData({ words: [...this.data.words, { word: "", meaning: "" }] });
  },
  removeWord(e: UIEvent) {
    this.setData({
      words: this.data.words.filter((_, i) => i !== Number(data(e, "index"))),
    });
  },
  async extract() {
    if (this.data.busy) return;
    if (!this.data.content.trim()) return toast("请先输入章节正文");
    this.setData({ busy: true, progress: "正在提取词表…" });
    try {
      const words = await ai.extractWords(this.data.content, (n, total) => {
        if (this.alive) this.setData({ progress: `正在提取 ${n}/${total}` });
      });
      if (this.alive) this.setData({ words });
    } catch (error) {
      if (this.alive) fail(error);
    } finally {
      if (this.alive) this.setData({ busy: false, progress: "" });
    }
  },
  async save() {
    if (this.data.busy) return;
    if (this.bookId === AI_BOOK) return toast("AI 课程章节不能手动修改");
    if (this.data.kind === "exam") {
      try {
        if (!this.data.title.trim()) throw new Error("请填写章节标题");
        if (
          !this.data.sections.length ||
          this.data.sections.some((s) => !s.title.trim() || !s.questions.length)
        )
          throw new Error("每个部分需要标题和至少一道题");
        const sections = this.data.sections.map((s) => ({
          id: s.id,
          title: s.title.trim(),
          material: s.material.trim(),
          questions: s.questions.map((q) =>
            parseExercise(
              {
                ...q,
                options: q.optionsText
                  .split(/\r?\n/)
                  .map((v) => v.trim())
                  .filter(Boolean),
                points: q.point
                  .split(/[、,，]/)
                  .map((v) => v.trim())
                  .filter(Boolean),
              },
              q.id,
            ),
          ),
        }));
        if (
          this.original &&
          !(await confirm(
            "保存题目修改",
            "修改试卷会清除本章旧答卷和批改结果，继续保存？",
          ))
        )
          return;
        const cid = this.original?.id || id(),
          text = sections.map((s) => s.title + "\n" + s.material).join("\n\n");
        const value: Chapter = {
          id: cid,
          bookId: this.bookId,
          title: this.data.title.trim(),
          kind: "exam",
          sections,
          rawText: text,
          tokens: tokenize(text),
          words: [],
          translations: [],
          translatedAt: 0,
          quizDone: false,
          createdAt: this.original?.createdAt || Date.now(),
        };
        store.saveChapter(value, true);
        store.transaction({}, ["exam_draft_" + cid, "exam_attempt_" + cid]);
        toast("题目章节已保存");
        wx.navigateBack();
      } catch (error) {
        fail(error);
      }
      return;
    }
    const title = this.data.title.trim(),
      text = this.data.content.trim();
    const words = this.data.words
      .map((w) => ({ word: w.word.trim(), meaning: w.meaning.trim() }))
      .filter((w) => w.word);
    if (!title || !text) return toast("请填写标题和正文");
    if (!words.length) return toast("请提取词表或手动添加词语");
    const contentChanged = !!this.original && text !== this.original.rawText;
    if (
      contentChanged &&
      store.marks(this.original!.id).length &&
      !(await confirm(
        "正文已改变",
        "修改正文会重新分词并清除旧划线；文字笔记仍保留。继续保存？",
      ))
    )
      return;
    this.setData({ busy: true, progress: "正在准备章节…" });
    try {
      const tokens = tokenize(text);
      const reuse =
        this.original?.rawText === text &&
        this.original.translations.length === tokens.sentences.length &&
        this.original.translations.every(Boolean);
      let translations = reuse
        ? this.original!.translations
        : tokens.sentences.map(() => "");
      let translated = !!reuse;
      if (!reuse) {
        try {
          translations = await ai.translate(tokens.sentences, (n, total) => {
            if (this.alive)
              this.setData({ progress: `正在翻译 ${n}/${total} 句` });
          });
          translated = true;
        } catch (error) {
          if (
            !this.alive ||
            !(await confirm(
              "句译暂未完成",
              (error instanceof Error ? error.message : "翻译失败") +
                "。是否先保存正文和词表，之后编辑时重试翻译？",
            ))
          )
            return;
        }
      }
      if (!this.alive) return;
      const changedWords =
        JSON.stringify(words) !== JSON.stringify(this.original?.words || []);
      const value: Chapter = {
        id: this.original?.id || id(),
        bookId: this.bookId,
        title,
        rawText: text,
        words,
        tokens,
        translations,
        translatedAt: translated ? Date.now() : 0,
        quizDone: !contentChanged && !changedWords && !!this.original?.quizDone,
        createdAt: this.original?.createdAt || Date.now(),
      };
      store.saveChapter(value, contentChanged);
      this.original = value;
      toast("章节已保存");
      wx.navigateBack();
    } catch (error) {
      if (this.alive) fail(error);
    } finally {
      if (this.alive) this.setData({ busy: false, progress: "" });
    }
  },
});
