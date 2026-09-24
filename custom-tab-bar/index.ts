Component({
  data: {
    selected: 0,
    themeStyle: "",
    tabs: [
      { path: "quiz", title: "闯关", icon: "spark" },
      { path: "shelf", title: "书架", icon: "book" },
      { path: "study", title: "学习", icon: "chat" },
      { path: "mine", title: "我的", icon: "user" },
    ],
  },
  methods: {
    switch(e: WechatMiniprogram.TouchEvent) {
      const path = String(e.currentTarget.dataset.path);
      wx.switchTab({ url: `/pages/${path}/${path}` });
    },
  },
});
