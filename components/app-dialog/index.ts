import { DialogOptions, DialogResult } from "../../services/dialog";
const pending = new WeakMap<object, (result: DialogResult) => void>();
Component({
  options: { styleIsolation: "apply-shared" },
  data: { visible: false, title: "", content: "", editable: false, placeholder: "", value: "", showCancel: true, items: [] as string[], confirmText: "确认" },
  lifetimes: { detached() { const resolve = pending.get(this); pending.delete(this); resolve?.({ confirm: false, content: "", tapIndex: -1 }); } },
  pageLifetimes: { hide() { this.cancel(); } },
  methods: {
    open(options: DialogOptions, resolve: (result: DialogResult) => void) {
      this.finish({ confirm: false, content: "", tapIndex: -1 });
      pending.set(this, resolve);
      this.setData({ visible: true, title: options.title || "请选择操作", content: options.content || "", editable: !!options.editable, placeholder: options.placeholderText || "", value: "", showCancel: options.showCancel !== false, items: options.itemList || [], confirmText: options.confirmText || "确认" });
    },
    finish(result: DialogResult) {
      const resolve = pending.get(this);
      pending.delete(this);
      if (resolve) { this.setData({ visible: false }); resolve(result); }
    },
    cancel() { this.finish({ confirm: false, content: "", tapIndex: -1 }); },
    accept() { this.finish({ confirm: true, content: this.data.value.trim(), tapIndex: -1 }); },
    choose(e: WechatMiniprogram.TouchEvent) { this.finish({ confirm: true, content: "", tapIndex: Number(e.currentTarget.dataset.index) }); },
    change(e: WechatMiniprogram.Input) { this.setData({ value: e.detail.value }); },
    noop() {},
  },
});
