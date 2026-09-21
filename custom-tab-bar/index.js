// custom-tab-bar —— 自定义底栏：图标与配色来自当前主题包
const theme = require('../utils/theme');

Component({
  data: {
    selected: 0,
    list: [],
    color: '#8A8F99',
    selectedColor: '#2B6CB0',
    background: '#FFFFFF',
    bgImage: '',
    style: ''
  },

  methods: {
    // 各 tab 页 onShow 里调用（theme.bindPage 会带过来）
    sync(index, t) {
      const tb = theme.tabBarData(t);
      this.setData({
        selected: index,
        list: tb.list,
        color: tb.color,
        selectedColor: tb.selectedColor,
        background: tb.background,
        bgImage: tb.bgImage,
        style: tb.style
      });
    },
    onTap(e) {
      const i = e.currentTarget.dataset.i;
      const item = this.data.list[i];
      if (!item || i === this.data.selected) return;
      wx.switchTab({ url: '/' + item.pagePath });
    }
  }
});
