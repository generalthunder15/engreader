import { Memory, emptyLearning } from "../../core/learning";
import { UIEvent } from "../../core/models";
import { load, updateProfile } from "../../services/learning";
import { bind } from "../../services/theme";
import { input, toast, fail } from "../../services/ui";
Page({
  data: {
    themeStyle: "",
    memory: emptyLearning().memory as Memory,
    profile: "",
  },
  onShow() {
    bind(this);
    const memory = load().memory;
    this.setData({ memory, profile: memory.profile });
  },
  input(e: UIEvent) {
    this.setData({ profile: input(e) });
  },
  save() {
    try {
      updateProfile(this.data.profile);
      toast("个人情况已更新，下次生成会参考");
    } catch (error) {
      fail(error);
    }
  },
});
