import { UIEvent } from "../../core/models";
import { closed } from "../../core/learning";
import { catalog, updateMemory, archiveMemory } from "../../services/learning";
import { bind } from "../../services/theme";
import { input, toast, fail, data } from "../../services/ui";
Page({
  data: {
    themeStyle: "",
    markdown: "",
    draft: "",
    editing: false,
    busy: false,
    updated: "",
    pending: [] as { id: string; title: string; error: string }[],
  },
  onShow() {
    bind(this);
    this.refresh();
  },
  refresh() {
    const state = catalog();
    this.setData({
      markdown: state.memory.markdown,
      updated: state.memory.updatedAt
        ? new Date(state.memory.updatedAt).toLocaleString()
        : "尚未归档更新",
      pending: state.sessions
        .filter(
          (s) => closed(s) && !state.memory.archivedSessions.includes(s.id),
        )
        .map((s) => ({
          id: s.id,
          title: s.title,
          error: s.memoryError || "等待生成归档总结",
        })),
    });
  },
  edit() {
    this.setData({ editing: true, draft: this.data.markdown });
  },
  cancel() {
    this.setData({ editing: false });
  },
  input(e: UIEvent) {
    this.setData({ draft: input(e) });
  },
  save() {
    try {
      updateMemory(this.data.draft);
      this.setData({ editing: false });
      this.refresh();
      toast("记忆文档已保存");
    } catch (error) {
      fail(error);
    }
  },
  async retry(e: UIEvent) {
    if (this.data.busy) return;
    this.setData({ busy: true });
    try {
      await archiveMemory(data(e, "id"));
      toast("归档记忆已更新");
    } catch (error) {
      fail(error);
    } finally {
      this.setData({ busy: false });
      this.refresh();
    }
  },
});
