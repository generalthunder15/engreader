// components/ai-panel/index.js —— AI 结果半屏弹层（翻译 / 语法解析 / 笔记 + 朗读）
Component({
  properties: {
    show: { type: Boolean, value: false },
    loading: { type: Boolean, value: false },
    type: { type: String, value: 'word' },        // word | sentence
    tab: { type: String, value: 'trans' },        // trans | grammar | detail | note（由页面控制）
    result: { type: Object, value: null },
    detailResult: { type: Object, value: null },  // 详细语法拆解结果
    detailLoading: { type: Boolean, value: false },
    qaLoading: { type: Boolean, value: false },   // 划词提问
    qaResult: { type: String, value: '' },
    qSuggestions: { type: Array, value: [] },     // 推荐问题
    playing: { type: Boolean, value: false },
    selectedText: { type: String, value: '' }
  },
  data: {
    noteValue: '',
    qaValue: ''
  },
  observers: {
    show(v) {
      if (v && this.properties.tab === 'note' && !this.data.noteValue) {
        this.setData({ noteValue: '' });
      }
    }
  },
  methods: {
    setTab(e) {
      this.triggerEvent('tabchange', { tab: e.currentTarget.dataset.t });
    },
    onClose() {
      this.triggerEvent('close');
    },
    onPlay() {
      this.triggerEvent(this.properties.playing ? 'stop' : 'play');
    },
    onAddVocab() {
      this.triggerEvent('addvocab');
    },
    onRetry() {
      this.triggerEvent('retry');
    },
    onDetail() {
      if (!this.properties.detailLoading) this.triggerEvent('detail');
    },
    // 卡片小喇叭：朗读卡片的英文内容（语法卡优先读例句）
    onSpeak(e) {
      const text = (e.currentTarget.dataset.text || '').trim();
      const fallback = (e.currentTarget.dataset.fallback || '').trim();
      this.triggerEvent('speak', { text: text || fallback });
    },
    onQaInput(e) {
      this.setData({ qaValue: e.detail.value });
    },
    onAsk() {
      const q = this.data.qaValue.trim();
      if (!q || this.properties.qaLoading) return;
      this.triggerEvent('ask', { question: q });
    },
    onChip(e) {
      const q = e.currentTarget.dataset.q;
      if (!q || this.properties.qaLoading) return;
      this.setData({ qaValue: q });
      this.triggerEvent('ask', { question: q });
    },
    onNoteInput(e) {
      this.setData({ noteValue: e.detail.value });
    },
    onSaveNote() {
      this.triggerEvent('savenote', { note: this.data.noteValue });
      this.setData({ noteValue: '' });
    },
    noop() {}
  }
});
