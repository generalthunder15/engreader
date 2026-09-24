import * as store from "../../services/storage";
import * as audio from "../../services/audio";
import { bind } from "../../services/theme";
import { UIEvent, Vocab } from "../../core/models";
import { data, input, confirm, fail } from "../../services/ui";
Page({
  data: { themeStyle: "", query: "", items: [] as Vocab[], total: 0 },
  onShow() {
    bind(this);
    this.refresh();
  },
  refresh() {
    const all = store.vocab();
    const q = this.data.query.toLowerCase();
    this.setData({
      total: all.length,
      items: all.filter((v) =>
        (v.word + " " + v.translation).toLowerCase().includes(q),
      ),
    });
  },
  search(e: UIEvent) {
    this.setData({ query: input(e) });
    this.refresh();
  },
  speak(e: UIEvent) {
    void audio.speak(data(e, "word")).catch(fail);
  },
  async remove(e: UIEvent) {
    if (!(await confirm("移出生词本", data(e, "word")))) return;
    try {
      store.write(
        "vocab",
        store.vocab().filter((v) => v.word !== data(e, "word")),
      );
      this.refresh();
    } catch (error) {
      fail(error);
    }
  },
  quiz() {
    store.write('quiz_target', { bookId: '', chapterId: '' });
    wx.switchTab({ url: "/pages/quiz/quiz" });
  },
  onHide() {
    audio.stop();
  },
  onUnload() {
    audio.stop();
  },
});
