import * as store from "../../services/storage";
import { diagnose, domainList, Probe } from "../../services/network";
import * as ai from "../../services/ai";
import * as fonts from "../../services/fonts";
import { themes, bind } from "../../services/theme";
import { UIEvent } from "../../core/models";
import { data, input, fail, toast, confirm } from "../../services/ui";
Page({
  data: {
    themeStyle: "",
    form: { ...store.defaults },
    testing: false,
    results: [] as Probe[],
    testMessage: "",
    themes,
    fonts: [] as fonts.Font[],
    sizes: [30, 34, 38, 42],
    lines: [1.8, 2.1, 2.4],
  },
  onShow() {
    bind(this);
    this.setData({ form: store.settings(), fonts: fonts.list() });
  },
  field(e: UIEvent) {
    const key = data(e, "key");
    if (key === "apiKey")
      this.setData({ ["form." + key]: input(e), testMessage: "", results: [] });
  },
  toggle(e: UIEvent) {
    const key = data(e, "key");
    if (["autoPlay", "localFallback", "showTrans"].includes(key))
      this.setData({ ["form." + key]: Boolean(e.detail.value) });
  },
  number(e: UIEvent) {
    const key = data(e, "key");
    if (["ttsSpeed", "quizCount"].includes(key))
      this.setData({ ["form." + key]: Number(e.detail.value) });
  },
  save() {
    try {
      const form = { ...this.data.form };
      form.apiKey = form.apiKey.trim();
      store.saveSettings(form);
      this.setData({ form: store.settings() });
      toast("设置已保存");
    } catch (error) {
      fail(error);
    }
  },
  async test() {
    if (this.data.testing) return;
    this.setData({
      testing: true,
      results: [],
      testMessage: "正在检测接口连通性…",
    });
    try {
      const results = await diagnose();
      this.setData({
        results,
        testMessage: "连通性检测完成；请点“测试模型”验证 Key",
      });
    } catch (error) {
      fail(error);
    } finally {
      this.setData({ testing: false });
    }
  },
  async testModel() {
    if (this.data.testing) return;
    this.setData({ testing: true, testMessage: "正在使用当前填写的 Key 测试模型…" });
    try {
      const r = await ai.chat(
        [{ role: "user", content: "Reply with OK." }],
        false,
        false,
        this.data.form.apiKey.trim(),
      );
      this.setData({ testMessage: "主模型响应：" + r.slice(0, 160) });
    } catch (error) {
      this.setData({
        testMessage: error instanceof Error ? error.message : "模型测试失败",
      });
    } finally {
      this.setData({ testing: false });
    }
  },
  domains() {
    wx.setClipboardData({ data: domainList() });
  },
  clearCache() {
    try {
      store.clearCache();
      toast("缓存已清理");
    } catch (error) {
      fail(error);
    }
  },
  appearance(e: UIEvent) {
    const key = data(e, "key"),
      value = data(e, "value");
    try {
      if (key === "theme") store.saveSettings({ theme: value });
      if (key === "fontRead")
        store.saveSettings({
          fontRead: value,
          ...(this.data.form.fontUi !== "system" ? { fontUi: value } : {}),
        });
      if (key === "readFontSize")
        store.saveSettings({ readFontSize: Number(value) });
      if (key === "readLineHeight")
        store.saveSettings({ readLineHeight: Number(value) });
      this.refreshAppearance();
    } catch (error) {
      fail(error);
    }
  },
  refreshAppearance() {
    const saved = store.settings();
    this.setData({
      form: {
        ...this.data.form,
        theme: saved.theme,
        fontRead: saved.fontRead,
        fontUi: saved.fontUi,
        readFontSize: saved.readFontSize,
        readLineHeight: saved.readLineHeight,
        readIndent: saved.readIndent,
      },
      fonts: fonts.list(),
    });
    bind(this);
  },
  indent(e: UIEvent) {
    try {
      store.saveSettings({ readIndent: e.detail.value ? 34 : 0 });
      this.refreshAppearance();
    } catch (error) {
      fail(error);
    }
  },
  sameFont(e: UIEvent) {
    try {
      store.saveSettings({
        fontUi: e.detail.value
          ? this.data.form.fontRead === "theme"
            ? "literata"
            : this.data.form.fontRead
          : "system",
      });
      this.refreshAppearance();
    } catch (error) {
      fail(error);
    }
  },
  async importFont() {
    try {
      const font = await fonts.install();
      store.saveSettings({ fontRead: font.id });
      this.refreshAppearance();
      toast("字体已安装");
    } catch (error) {
      if (
        !String((error as { errMsg?: string })?.errMsg || "").includes("cancel")
      )
        fail(error);
    }
  },
  async removeFont(e: UIEvent) {
    if (!(await confirm("删除字体", "正在使用此字体的文字将恢复系统字体。")))
      return;
    try {
      fonts.remove(data(e, "id"));
      this.refreshAppearance();
    } catch (error) {
      fail(error);
    }
  },
});
