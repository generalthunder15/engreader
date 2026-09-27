import { showActionSheet } from "../../services/dialog";
import * as store from "../../services/storage";
import { bind } from "../../services/theme";
import { cover, data, navigate, confirm, fail, toast } from "../../services/ui";
import { OutlineBook } from "../../core/book-outline";
import { bookView } from "../../services/book-view";
import { UIEvent } from "../../core/models";
import { AI_BOOK } from "../../core/learning";
Page({
  data: { themeStyle: "", book: null as OutlineBook | null, cover: "", finished: 0 },
  bookId: "",
  onLoad(query: Record<string, string>) {
    this.bookId = query.id || "";
  },
  onShow() {
    bind(this);
    this.refresh();
  },
  refresh() {
    const book = bookView(this.bookId);
    this.setData({
      book,
      cover: cover(book?.hue ?? 160),
      finished: book?.chapters.filter((c) => c.quizDone).length || 0,
    });
    if (book) wx.setNavigationBarTitle({ title: book.title });
  },
  add() {
    if (this.bookId === AI_BOOK) {
      wx.switchTab({ url: "/pages/study/study" });
      return;
    }
    navigate("chapter-edit", { bookId: this.bookId });
  },
  open(e: UIEvent) {
    navigate("reader", { bookId: this.bookId, chapterId: data(e, "id") });
  },
  chapterMenu(e: UIEvent) {
    if (this.bookId === AI_BOOK) return;
    showActionSheet({
      itemList: ["编辑", "删除"],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) this.edit(e);
        else if (tapIndex === 1) void this.remove(e);
      },
    });
  },
  edit(e: UIEvent) {
    if (this.bookId === AI_BOOK) return toast("AI 课程章节由学习流程管理");
    navigate("chapter-edit", { bookId: this.bookId, chapterId: data(e, "id") });
  },
  resume() {
    const b = this.data.book;
    const cid =
      b?.chapters.find((c) => c.id === b.lastChapterId)?.id ||
      b?.chapters[0]?.id;
    if (!cid) return toast("先添加一个章节吧");
    navigate("reader", { bookId: this.bookId, chapterId: cid });
  },
  async remove(e: UIEvent) {
    if (
      !(await confirm("删除章节", "章节正文、划线、笔记及章节收藏将一并删除。"))
    )
      return;
    try {
      store.deleteChapter(this.bookId, data(e, "id"));
      this.refresh();
    } catch (error) {
      fail(error);
    }
  },
});
