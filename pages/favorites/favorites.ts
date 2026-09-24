import * as store from "../../services/storage";
import { Favorite, UIEvent } from "../../core/models";
import { bind } from "../../services/theme";
import { data, navigate, fail, toast } from "../../services/ui";
Page({
  data: { themeStyle: "", items: [] as Favorite[] },
  onShow() {
    bind(this);
    this.setData({ items: store.favorites() });
  },
  open(e: UIEvent) {
    const b = data(e, "book"),
      c = data(e, "chapter");
    if (!store.chapter(b, c)) return toast("此章节已不存在");
    navigate("reader", { bookId: b, chapterId: c });
  },
  remove(e: UIEvent) {
    try {
      const items = store.favorites().filter((f) => f.id !== data(e, "id"));
      store.write("favors", items);
      this.setData({ items });
    } catch (error) {
      fail(error);
    }
  },
});
