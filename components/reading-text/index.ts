import { readingParagraphs, tokenize, joinTokens } from "../../core/text";
import { SelectionRect } from "../../core/selection-menu";
const timers = new WeakMap<object, ReturnType<typeof setTimeout>>();
Component({
  properties: { text: String, indented: { type: Boolean, value: false }, selectionKey: String, activeKey: String },
  data: { paragraphs: [] as ReturnType<typeof readingParagraphs>, start: -1, end: -1, lastId: -1, lastAt: 0, held: false, x: 0, y: 0, moved: false },
  observers: {
    text(value: string) { this.cancelTap(); this.setData({ paragraphs: readingParagraphs(value, tokenize(value).paragraphs.flatMap(p => p.tokens)), start: -1, end: -1 }); },
    activeKey(value: string) { if (value !== this.properties.selectionKey) this.setData({ start: -1, end: -1 }); },
  },
  pageLifetimes: { hide() { this.cancelTap(); } },
  lifetimes: { detached() { this.cancelTap(); } },
  methods: {
    cancelTap() { const timer = timers.get(this); if (timer) clearTimeout(timer); timers.delete(this); },
    noop() {},
    begin(e: WechatMiniprogram.TouchEvent) { this.setData({ held: false, moved: false, x: e.touches[0]?.clientX || 0, y: e.touches[0]?.clientY || 0 }); },
    move(e: WechatMiniprogram.TouchEvent) {
      const p = e.touches[0];
      if (p && (Math.abs(p.clientX - this.data.x) > 10 || Math.abs(p.clientY - this.data.y) > 10)) { this.cancelTap(); this.setData({ moved: true, lastId: -1 }); }
    },
    tap(e: WechatMiniprogram.TouchEvent) {
      if (this.data.held || this.data.moved) return;
      const id = Number(e.currentTarget.dataset.id);
      if (this.data.lastId === id && Date.now() - this.data.lastAt < 320) {
        this.cancelTap(); this.setData({ lastId: -1 }); this.select(id, false);
      } else {
        this.cancelTap(); this.setData({ lastId: id, lastAt: Date.now() });
        timers.set(this, setTimeout(() => { this.triggerEvent("readtap"); this.setData({ lastId: -1 }); }, 320));
      }
    },
    hold(e: WechatMiniprogram.TouchEvent) { this.cancelTap(); this.setData({ held: true, lastId: -1 }); this.select(Number(e.currentTarget.dataset.id), true); },
    select(id: number, sentence: boolean) {
      const all = this.data.paragraphs.flatMap(p => p.tokens), token = all.find(t => t.id === id);
      if (!token) return;
      const chosen = sentence ? all.filter(t => t.sid === token.sid) : [token];
      this.setData({ start: chosen[0].id, end: chosen[chosen.length - 1].id }, () => {
        this.createSelectorQuery().selectAll(".chosen").boundingClientRect().exec((r: SelectionRect[][]) => {
          this.triggerEvent("selection", { text: joinTokens(chosen), rects: r[0] || [], key: this.properties.selectionKey });
        });
      });
    },
  },
});
