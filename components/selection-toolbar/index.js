// components/selection-toolbar/index.js —— 划词操作栏浮层
Component({
  properties: {
    show: { type: Boolean, value: false },
    left: { type: Number, value: 0 },
    top: { type: Number, value: 0 }
  },
  methods: {
    fire(e) {
      this.triggerEvent('action', { act: e.currentTarget.dataset.act });
    },
    onMask() {
      this.triggerEvent('action', { act: 'close' });
    },
    noop() {}
  }
});
