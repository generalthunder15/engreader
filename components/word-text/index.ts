Component({
  properties: {
    text: { type: String, value: "" },
    selectedIndex: { type: Number, value: -1 },
  },
  data: { lastTap: 0, lastIndex: -1, tokens: [] as { text: string; word: boolean }[] },
  observers: {
    text(value: string) {
      this.setData({ tokens: (value.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*|[^A-Za-z]+/g) || []).map(text => ({ text, word: /^[A-Za-z]/.test(text) })) });
    },
  },
  methods: {
    tap(e: WechatMiniprogram.TouchEvent) {
      const index = Number(e.currentTarget.dataset.index);
      const token = this.data.tokens[index];
      if (!token?.word) return;
      const now = Date.now();
      if (this.data.lastIndex === index && now - this.data.lastTap < 350) {
        this.data.lastTap = 0;
        this.triggerEvent("word", { word: token.text, index, y: e.changedTouches[0]?.clientY || 200, x: e.changedTouches[0]?.clientX || 100 });
      } else {
        this.data.lastIndex = index;
        this.data.lastTap = now;
      }
    },
  },
});

