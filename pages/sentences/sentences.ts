import * as store from "../../services/storage";
import * as audio from "../../services/audio";
import { Sentence, UIEvent } from "../../core/models";
import { bind } from "../../services/theme";
import { data, navigate, confirm, fail, toast } from "../../services/ui";
Page({
  data: { themeStyle: "", items: [] as Sentence[] },
  onShow() {
    bind(this);
    this.setData({ items: store.sentences() });
  },
  speak(e: UIEvent) {
    void audio.speak(data(e, "text")).catch(fail);
  },
  open(e: UIEvent) {
    const b = data(e, "book"),
      c = data(e, "chapter");
    if (!store.chapter(b, c)) return toast("原章节已删除，收藏内容仍保留");
    navigate("reader", { bookId: b, chapterId: c });
  },
  async remove(e: UIEvent) {
    if (!(await confirm("删除收藏", "从句集移除这条句子？"))) return;
    try {
      const items = store.sentences().filter((s) => s.id !== data(e, "id"));
      store.write("sentences", items);
      this.setData({ items });
    } catch (error) {
      fail(error);
    }
  },
  onHide() {
    audio.stop();
  },
  onUnload() {
    audio.stop();
  },
});
