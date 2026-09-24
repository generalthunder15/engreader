import { Block, ReaderFlow } from "../../core/reader";
import { Book, Definition, Detail, Note, UIEvent } from "../../core/models";
import { joinTokens } from "../../core/text";
import * as store from "../../services/storage";
import * as ai from "../../services/ai";
import * as dictionary from "../../services/dictionary";
import * as audio from "../../services/audio";
import { bind } from "../../services/theme";
import { data, input, navigate, fail, toast, confirm } from "../../services/ui";

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  dataset: { token: number };
}
Page({
  data: {
    themeStyle: "",
    themeId: "default",
    themePrimary: "#416C64",
    book: null as Book | null,
    chapterId: "",
    chapterTitle: "",
    blocks: [] as Block[],
    index: 0,
    total: 0,
    percent: 0,
    controls: false,
    toc: false,
    selectedText: "",
    toolbar: false,
    showTrans: false,
    favored: false,
    hasMore: false,
    statusHeight: 24,
    panel: false,
    tab: "translation",
    busy: false,
    panelError: "",
    definition: null as Definition | null,
    detail: null as Detail | null,
    question: "",
    answer: "",
    suggestions: [] as string[],
    note: "",
    playing: false,
    noteList: [] as Note[],
    noteChapter: "",
    notesOpen: false,
    actions: [
      { id: "translate", icon: "translate", text: "翻译" },
      { id: "ask", icon: "chat", text: "提问" },
      { id: "mark", icon: "pen", text: "划线" },
      { id: "note", icon: "note", text: "笔记" },
      { id: "favorite", icon: "bookmark", text: "收藏" },
      { id: "speak", icon: "volume", text: "朗读" },
      { id: "copy", icon: "copy", text: "复制" },
    ],
  },
  flow: new ReaderFlow(),
  alive: true,
  request: 0,
  bookId: "",
  loaded: [] as string[],
  published: [] as string[],
  selectedCid: "",
  anchors: [] as { cid: string; top: number }[],
  scrollTop: 0,
  tap: { id: -1, at: 0 },
  tapTimer: null as ReturnType<typeof setTimeout> | null,
  touchId: -1,
  dragEnd: -1,
  dragging: false,
  longPressed: false,
  touchX: 0,
  touchY: 0,
  rects: [] as Rect[],
  dayTheme: "default",
  onLoad(query: Record<string, string>) {
    this.bookId = query.bookId || "";
    const book = store.book(this.bookId);
    this.setData({
      book,
      total: book?.chapters.length || 0,
      showTrans: store.settings().showTrans,
      statusHeight: wx.getWindowInfo().statusBarHeight || 24,
    });
    if (book)
      this.start(
        query.chapterId || book.lastChapterId || book.chapters[0]?.id || "",
      );
    else toast("书籍不存在");
  },
  onShow() {
    bind(this);
    const theme = store.settings().theme;
    if (theme !== "night") this.dayTheme = theme;
    const book = store.book(this.bookId);
    if (book) {
      this.setData({
        book,
        total: book.chapters.length,
        showTrans: store.settings().showTrans,
      });
      this.refreshDecorations();
      wx.nextTick(() => this.measure());
    }
  },
  start(cid: string) {
    if (!store.chapter(this.bookId, cid)) {
      toast("章节不存在");
      return;
    }
    this.closePanel();
    this.flow = new ReaderFlow();
    this.loaded = [];
    this.published = [];
    this.setData({ blocks: [] });
    this.anchors = [];
    this.scrollTop = 0;
    this.append(cid);
    this.setCurrent(cid);
    this.setData({ toc: false, controls: false });
    wx.pageScrollTo({ scrollTop: 0, duration: 0 });
  },
  append(cid: string) {
    const chapter = store.chapter(this.bookId, cid);
    if (!chapter || this.loaded.includes(cid)) return;
    this.flow.append(chapter, store.marks(cid), store.notes(cid));
    this.loaded.push(cid);
    const chapters = this.data.book?.chapters || [];
    this.setData({
      hasMore: chapters.findIndex((c) => c.id === cid) < chapters.length - 1,
    });
    this.publishBlocks();
    wx.nextTick(() => this.measure());
  },
  onReachBottom() {
    const chapters = this.data.book?.chapters || [];
    const index = chapters.findIndex(
      (c) => c.id === this.loaded[this.loaded.length - 1],
    );
    if (chapters[index + 1]) this.append(chapters[index + 1].id);
  },
  measure() {
    if (!this.alive) return;
    const q = wx.createSelectorQuery().in(this);
    q.selectAll(".chapter-anchor").boundingClientRect();
    q.exec((result: Rect[][]) => {
      if (!this.alive) return;
      this.anchors = (result[0] || []).map((r, i) => ({
        cid: this.loaded[i],
        top: r.top + this.scrollTop,
      }));
    });
  },
  setCurrent(cid: string) {
    const chapters = this.data.book?.chapters || [];
    const index = chapters.findIndex((c) => c.id === cid);
    if (index < 0) return;
    this.setData({
      chapterId: cid,
      chapterTitle: chapters[index].title,
      index,
      percent: Math.round(((index + 1) / chapters.length) * 100),
      favored: store.isFavorite(this.bookId, cid),
    });
    try {
      store.touchBook(this.bookId, cid);
    } catch (error) {
      fail(error);
    }
  },
  onPageScroll(event: { scrollTop: number }) {
    this.scrollTop = event.scrollTop;
    if (this.data.controls) this.setData({ controls: false });
    let current = this.anchors[0];
    for (const anchor of this.anchors)
      if (anchor.top <= event.scrollTop + 100) current = anchor;
    if (current && current.cid !== this.data.chapterId)
      this.setCurrent(current.cid);
  },
  refreshDecorations() {
    for (const block of this.flow.blocks) {
      const marks = store.marks(block.cid);
      block.tokens.forEach((t) => {
        t.marked = marks.some((m) => t.id >= m.start && t.id <= m.end);
      });
      block.notes = store
        .notes(block.cid)
        .filter(
          (n) =>
            block.text.toLowerCase().includes(n.sel.toLowerCase()) ||
            n.sel.toLowerCase().includes(block.text.toLowerCase()),
        );
    }
    this.setData({
      favored: store.isFavorite(this.bookId, this.data.chapterId),
    });
    this.publishBlocks();
  },
  publishBlocks() {
    let patch: Record<string, Block> = {};
    let size = 0;
    this.flow.blocks.forEach((block, index) => {
      const serialized = JSON.stringify(block);
      if (this.published[index] === serialized) return;
      // Bound each bridge message, even when reading an entire book continuously.
      if (size + serialized.length * 3 > 250000 && size) { this.setData(patch); patch = {}; size = 0; }
      patch['blocks[' + index + ']'] = block;
      size += serialized.length * 3;
      this.published[index] = serialized;
    });
    if (size) this.setData(patch);
  },
  back() {
    wx.navigateBack({
      fail: () => wx.switchTab({ url: "/pages/shelf/shelf" }),
    });
  },
  toggleControls() {
    if (this.data.toolbar) {
      this.clearSelection();
      return;
    }
    this.setData({ controls: !this.data.controls });
  },
  showToc() {
    this.setData({ toc: true, controls: false });
  },
  closeToc() {
    this.setData({ toc: false });
  },
  pickChapter(e: UIEvent) {
    this.start(data(e, "id"));
  },
  previous() {
    const cid = this.data.book?.chapters[this.data.index - 1]?.id;
    if (cid) this.start(cid);
    else toast("已是第一章");
  },
  next() {
    const cid = this.data.book?.chapters[this.data.index + 1]?.id;
    if (cid) this.start(cid);
    else toast("已是最后一章");
  },
  slider(e: UIEvent) {
    const cid = this.data.book?.chapters[Number(input(e))]?.id;
    if (cid) this.start(cid);
  },
  settings() {
    navigate("settings");
  },
  quiz() {
    store.write("quiz_target", {
      bookId: this.bookId,
      chapterId: this.data.chapterId,
    });
    wx.switchTab({ url: "/pages/quiz/quiz" });
  },
  night() {
    try {
      store.saveSettings({
        theme: store.settings().theme === "night" ? this.dayTheme : "night",
      });
      bind(this);
    } catch (error) {
      fail(error);
    }
  },
  translation() {
    try {
      store.saveSettings({ showTrans: !this.data.showTrans });
      this.setData({ showTrans: !this.data.showTrans });
    } catch (error) {
      fail(error);
    }
  },
  favorite() {
    try {
      this.setData({
        favored: store.toggleFavorite({
          bookId: this.bookId,
          chapterId: this.data.chapterId,
          title: this.data.chapterTitle,
          bookTitle: this.data.book?.title || "",
        }),
      });
    } catch (error) {
      fail(error);
    }
  },
  touchStart(e: WechatMiniprogram.TouchEvent) {
    this.touchId = Number(e.currentTarget.dataset.token);
    this.dragEnd = this.touchId;
    this.dragging = false;
    this.longPressed = false;
    this.touchX = e.touches[0]?.clientX || 0;
    this.touchY = e.touches[0]?.clientY || 0;
    const q = wx.createSelectorQuery().in(this);
    q.selectAll(".token").boundingClientRect();
    q.exec((r: Rect[][]) => {
      this.rects = r[0] || [];
    });
  },
  touchMove(e: WechatMiniprogram.TouchEvent) {
    const point = e.touches[0];
    if (!point || this.touchId < 0) return;
    // Normal vertical movement continues to scroll; selection starts with a horizontal drag or a held sentence.
    if (
      !this.dragging &&
      !this.longPressed &&
      (Math.abs(point.clientX - this.touchX) < 12 ||
        Math.abs(point.clientY - this.touchY) >
          Math.abs(point.clientX - this.touchX))
    )
      return;
    const rect = this.rects.find(
      (r) =>
        point.clientX >= r.left &&
        point.clientX <= r.right &&
        point.clientY >= r.top &&
        point.clientY <= r.bottom,
    );
    if (!rect) return;
    this.dragging = true;
    this.cancelTap();
    this.dragEnd = Number(rect.dataset.token);
    this.select(this.touchId, this.dragEnd);
  },
  touchEnd(e: WechatMiniprogram.TouchEvent) {
    const target = this.touchId;
    this.touchId = -1;
    if (target < 0 || this.dragging || this.longPressed) return;
    const point = e.changedTouches[0];
    if (
      point &&
      (Math.abs(point.clientX - this.touchX) > 12 ||
        Math.abs(point.clientY - this.touchY) > 12)
    )
      return;
    if (this.tap.id === target && Date.now() - this.tap.at < 320) {
      this.cancelTap();
      this.select(target, target);
      return;
    }
    this.cancelTap();
    this.tap = { id: target, at: Date.now() };
    this.tapTimer = setTimeout(() => {
      this.tap = { id: -1, at: 0 };
      this.toggleControls();
    }, 320);
  },
  hold(e: UIEvent) {
    this.cancelTap();
    this.longPressed = true;
    const tokens = this.flow.sentence(Number(data(e, "token")));
    if (tokens.length)
      this.select(tokens[0].globalId, tokens[tokens.length - 1].globalId);
  },
  cancelTap() {
    if (this.tapTimer) clearTimeout(this.tapTimer);
    this.tapTimer = null;
    this.tap = { id: -1, at: 0 };
  },
  select(start: number, end: number) {
    const tokens = this.flow.select(start, end);
    this.request++;
    this.selectedCid = tokens[0]?.cid || this.data.chapterId;
    this.setData({
      selectedText: joinTokens(tokens),
      toolbar: !!tokens.length,
      controls: false,
    });
    this.publishBlocks();
  },
  clearSelection() {
    this.flow.clear();
    this.setData({
      toolbar: false,
      selectedText: "",
    });
    this.publishBlocks();
  },
  async action(e: UIEvent) {
    const action = data(e, "action"),
      text = this.data.selectedText;
    if (!text) return;
    try {
      if (action === "copy") {
        wx.setClipboardData({ data: text });
        this.clearSelection();
      } else if (action === "mark") {
        const values: Record<string, unknown> = {};
        for (const range of this.flow.ranges()) {
          const marks = store.marks(range.cid);
          const hit = marks.find(
            (m) => m.start <= range.start && m.end >= range.end,
          );
          values["marks_" + range.cid] = hit
            ? marks.filter((m) => m !== hit)
            : [
                ...marks,
                {
                  start: range.start,
                  end: range.end,
                  text: range.text,
                  createdAt: Date.now(),
                },
              ];
        }
        store.transaction(values);
        this.clearSelection();
        this.refreshDecorations();
      } else if (action === "favorite") {
        store.addSentence({
          text,
          translation: this.cachedTranslation(),
          bookId: this.bookId,
          chapterId: this.selectedCid,
          bookTitle: this.data.book?.title || "",
          chapterTitle:
            store.chapter(this.bookId, this.selectedCid)?.title || "",
        });
        toast("已收藏句子");
      } else if (action === "speak") await audio.speak(text);
      else {
        this.request++;
        this.setData({
          panel: true,
          toolbar: false,
          tab:
            action === "note"
              ? "note"
              : action === "ask"
                ? "ask"
                : "translation",
          definition: null,
          detail: null,
          question: "",
          answer: "",
          note: "",
          panelError: "",
          busy: false,
          suggestions: [],
        });
        if (action === "translate") await this.explain();
        if (action === "ask") {
          const ticket = this.request;
          void ai
            .suggestions(text)
            .then((suggestions) => {
              if (this.alive && ticket === this.request)
                this.setData({ suggestions });
            })
            .catch(() => {});
        }
      }
    } catch (error) {
      fail(error);
    }
  },
  cachedTranslation(): string {
    return this.flow.blocks
      .filter((b) => b.tokens.some((t) => t.selected))
      .map((b) => b.translation)
      .filter(Boolean)
      .join(" ");
  },
  async explain(force = false) {
    if (this.data.busy) return;
    const ticket = ++this.request,
      text = this.data.selectedText;
    const single = dictionary.isWord(text);
    this.setData({ busy: true, panelError: "" });
    try {
      let definition: Definition;
      if (single && !force)
        definition = await dictionary
          .lookup(text)
          .catch(() => ai.explain(text, true));
      else {
        try {
          definition = await ai.explain(text, single);
        } catch (error) {
          const cached = this.cachedTranslation();
          if (cached && store.settings().localFallback && !force)
            definition = { translation: cached, source: "offline" };
          else throw error;
        }
      }
      if (this.alive && ticket === this.request) {
        this.setData({ definition });
        if (store.settings().autoPlay) void this.play();
      }
    } catch (error) {
      if (this.alive && ticket === this.request)
        this.setData({
          panelError: error instanceof Error ? error.message : "查询失败",
        });
    } finally {
      if (this.alive && ticket === this.request) this.setData({ busy: false });
    }
  },
  retry() {
    void this.explain(true);
  },
  async tab(e: UIEvent) {
    const tab = data(e, "tab");
    this.setData({ tab });
    if (tab !== "detail" || this.data.detail || this.data.busy) return;
    const ticket = ++this.request;
    this.setData({ busy: true, panelError: "" });
    try {
      const detail = await ai.detail(this.data.selectedText);
      if (this.alive && ticket === this.request) this.setData({ detail });
    } catch (error) {
      if (this.alive && ticket === this.request)
        this.setData({
          panelError: error instanceof Error ? error.message : "解析失败",
        });
    } finally {
      if (this.alive && ticket === this.request) this.setData({ busy: false });
    }
  },
  closePanel() {
    this.request++;
    audio.stop();
    this.setData({ panel: false, busy: false, playing: false });
    this.clearSelection();
  },
  field(e: UIEvent) {
    const key = data(e, "key");
    if (key === "note" || key === "question") this.setData({ [key]: input(e) });
  },
  suggestion(e: UIEvent) {
    this.setData({ question: data(e, "text") });
    void this.ask();
  },
  async ask() {
    if (this.data.busy || !this.data.question.trim()) return;
    const ticket = ++this.request;
    this.setData({ busy: true, panelError: "" });
    try {
      const answer = await ai.ask(
        this.data.selectedText,
        this.data.question.trim(),
      );
      if (this.alive && ticket === this.request) this.setData({ answer });
    } catch (error) {
      if (this.alive && ticket === this.request)
        this.setData({
          panelError: error instanceof Error ? error.message : "提问失败",
        });
    } finally {
      if (this.alive && ticket === this.request) this.setData({ busy: false });
    }
  },
  saveNote() {
    if (!this.data.note.trim()) return toast("请写下笔记");
    try {
      const range = this.flow.ranges()[0];
      const cid = range?.cid || this.selectedCid;
      store.write("notes_" + cid, [
        {
          sel: this.data.selectedText,
          note: this.data.note.trim(),
          createdAt: Date.now(),
          ...(range ? { start: range.start, end: range.end } : {}),
        },
        ...store.notes(cid),
      ]);
      this.refreshDecorations();
      this.closePanel();
      toast("笔记已保存");
    } catch (error) {
      fail(error);
    }
  },
  addVocab() {
    const value = this.data.definition;
    if (!value) return;
    try {
      store.addVocab({
        word: this.data.selectedText,
        translation: value.translation,
        phonetic: value.phonetic || "",
        pos: value.pos || "",
        bookId: this.bookId,
        chapterId: this.selectedCid,
        fromBook: this.data.book?.title || "",
        fromChapter: store.chapter(this.bookId, this.selectedCid)?.title || "",
        createdAt: Date.now(),
      });
      toast("已加入生词本");
    } catch (error) {
      fail(error);
    }
  },
  async play() {
    if (this.data.playing) {
      audio.stop();
      this.setData({ playing: false });
      return;
    }
    const ticket = this.request;
    this.setData({ playing: true });
    try {
      await audio.speak(this.data.selectedText);
    } catch (error) {
      if (ticket === this.request) fail(error);
    } finally {
      if (this.alive && ticket === this.request)
        this.setData({ playing: false });
    }
  },
  speakText(e: UIEvent) {
    void audio.speak(data(e, "text")).catch(fail);
  },
  openNotes(e: UIEvent) {
    const block = this.flow.blocks.find((b) => b.uid === data(e, "uid"));
    if (block)
      this.setData({
        notesOpen: true,
        noteList: block.notes,
        noteChapter: block.cid,
      });
  },
  closeNotes() {
    this.setData({ notesOpen: false });
  },
  async deleteNote(e: UIEvent) {
    if (!(await confirm("删除笔记", "确定删除这条笔记？"))) return;
    const timestamp = Number(data(e, "time"));
    try {
      store.write(
        "notes_" + this.data.noteChapter,
        store
          .notes(this.data.noteChapter)
          .filter((n) => n.createdAt !== timestamp),
      );
      this.setData({
        noteList: this.data.noteList.filter((n) => n.createdAt !== timestamp),
      });
      this.refreshDecorations();
    } catch (error) {
      fail(error);
    }
  },
  noop() {},
  onHide() {
    audio.stop();
    this.cancelTap();
  },
  onUnload() {
    this.alive = false;
    this.request++;
    this.cancelTap();
    audio.stop();
  },
});
