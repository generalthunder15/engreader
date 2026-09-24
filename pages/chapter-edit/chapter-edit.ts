import * as store from "../../services/storage";
import * as ai from "../../services/ai";
import { bind } from "../../services/theme";
import { data, input, fail, toast, confirm } from "../../services/ui";
import { Chapter, UIEvent, Word, id } from "../../core/models";
import { tokenize } from "../../core/text";
Page({
  data: {
    themeStyle: "",
    title: "",
    content: "",
    words: [] as Word[],
    busy: false,
    progress: "",
    editing: false,
  },
  bookId: "",
  original: null as Chapter | null,
  alive: true,
  onLoad(query: Record<string, string>) {
    this.bookId = query.bookId || "";
    this.original = store.chapter(this.bookId, query.chapterId || "");
    if (this.original)
      this.setData({
        title: this.original.title,
        content: this.original.rawText,
        words: this.original.words.map((w) => ({ ...w })),
        editing: true,
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
