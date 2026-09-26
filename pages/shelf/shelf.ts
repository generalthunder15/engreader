import { showModal } from "../../services/dialog";
import * as store from "../../services/storage";
import { bind } from "../../services/theme";
import { cover, data, navigate, confirm, fail } from "../../services/ui";
import { UIEvent } from "../../core/models";
import { initialize } from "../../services/learning";
Page({
  data: {
    themeStyle: "",
    books: [] as (ReturnType<typeof store.books>[number] & {
      cover: string;
      subtitle: string;
    })[],
    totalChapters: 0,
  },
  onShow() {
    bind(this, 1);
    try {
      initialize();
    } catch (error) {
      fail(error);
    }
    this.refresh();
  },
  refresh() {
    const books = store.books().map((b) => ({
      ...b,
      cover: cover(b.hue),
      subtitle: b.lastReadAt
        ? "最近阅读 " + new Date(b.lastReadAt).toLocaleDateString()
        : "尚未开始阅读",
    }));
    this.setData({
      books,
      totalChapters: books.reduce((n, b) => n + b.chapterCount, 0),
    });
  },
  create() {
    showModal({
      title: "创建一本新书",
      editable: true,
      placeholderText: "输入书名",
      success: (r) => {
        if (!r.confirm) return;
        try {
          const b = store.createBook(r.content || "");
          this.refresh();
          navigate("book", { id: b.id });
        } catch (error) {
          fail(error);
        }
      },
    });
  },
  open(e: UIEvent) {
    navigate("book", { id: data(e, "id") });
  },
  async remove(e: UIEvent) {
    if (
      !(await confirm(
        "删除书籍",
        "将删除书籍、章节及其划线笔记。此操作不可恢复。",
      ))
    )
      return;
    try {
      store.deleteBook(data(e, "id"));
      this.refresh();
    } catch (error) {
      fail(error);
    }
  },
});
