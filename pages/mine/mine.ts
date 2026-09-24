import * as store from "../../services/storage";
import { clearUserData } from "../../services/library";
import { gc } from "../../services/fonts";
import { bind } from "../../services/theme";
import { UIEvent } from "../../core/models";
import { data, navigate, confirm, fail, toast } from "../../services/ui";
Page({
  data: { themeStyle: "", books: 0, vocab: 0, sentences: 0, favorites: 0 },
  onShow() {
    bind(this, 3);
    this.setData({
      books: store.books().length,
      vocab: store.vocab().length,
      sentences: store.sentences().length,
      favorites: store.favorites().length,
    });
  },
  go(e: UIEvent) {
    navigate(data(e, "page"));
  },
  clear() {
    wx.showActionSheet({
      itemList: ["清除学习数据，保留设置", "清除学习数据和全部设置"],
      success: async (r) => {
        if (
          !(await confirm(
            "确认清除",
            "自建书、收藏、笔记、学习记录和导入字体将被清除，内置读物保留。建议先到设置中导出备份。",
          ))
        )
          return;
        try {
          clearUserData(r.tapIndex === 1);
          gc();
          this.onShow();
          toast("已清除");
        } catch (error) {
          fail(error);
        }
      },
    });
  },
});
