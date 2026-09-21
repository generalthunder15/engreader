// pages/study/study —— AI 学习教练
// 流程：摸底(20-30道交互选择题，一次一题) → AI 出学习计划(推荐书架章节)
//      → 阅读任务(章节单词闯关，闯关完成前提问框灰色) → AI 问答(填空/主观，一次一题)
// 对话与学习者画像全程持久化（store.setStudy），AI 每轮都能"记得"你的学习情况
const store = require('../../utils/store');
const theme = require('../../utils/theme');
const ai = require('../../utils/ai');

const ASSESS_TOTAL = 24; // 摸底题数（20-30 之间取 24）

Page({
  data: {
    phase: 'idle',       // idle | assess | reading | qa
    msgs: [],            // [{id, role:'ai'|'me', text, q, time}]
    plan: null,          // {text, chapters:[{bookId,chapterId,title,done}]}
    planDoneCount: 0,
    planTotal: 0,
    input: '',
    sending: false,
    inputEnabled: false,
    inputTip: '',
    scrollInto: ''
  },

  onShow() {
    theme.bindPage(this, 2);
    this.syncFromStore();
  },

  syncFromStore() {
    const st = store.getStudy();
    // 恢复历史消息（assistant 消息 content 是 JSON）
    const msgs = ((st.qa && st.qa.messages) || []).map((m, i) => {
      let text = m.content;
      let q = null;
      if (m.role === 'assistant') {
        try {
          const r = JSON.parse(m.content);
          text = r.reply;
          q = r.question || null;
        } catch (e) {}
      }
      return { id: 'm' + i, role: m.role === 'assistant' ? 'ai' : 'me', text, q, time: m.ts };
    });
    const plan = st.plan || null;
    const chs = plan && plan.chapters ? plan.chapters : [];
    this.setData({
      phase: st.phase,
      msgs,
      plan,
      planTotal: chs.length,
      planDoneCount: chs.filter((c) => c.done).length,
      inputEnabled: st.phase === 'assess' || st.phase === 'qa',
      inputTip:
        st.phase === 'reading'
          ? '完成当前阅读任务的章节闯关后才能继续向 AI 提问'
          : ''
    });
    this.st = st;
    this.scrollToBottom();
  },

  buildBookshelf() {
    const lines = [];
    store.listBooks().forEach((b) => {
      (b.chapters || []).forEach((c, i) => {
        lines.push('- bookId=' + b.id + ', chapterId=' + c.id + ', 《' + b.title + '》第' + (i + 1) + '章「' + c.title + '」' + (c.quizDone ? '（已闯关）' : ''));
      });
    });
    return lines.join('\n');
  },

  scrollToBottom() {
    const last = this.data.msgs.length ? this.data.msgs[this.data.msgs.length - 1].id : '';
    this.setData({ scrollInto: last ? 'wrap-' + last : '' });
  },

  // ---------- 开始摸底 ----------
  startAssess() {
    store.resetStudy();
    const st = store.getStudy();
    st.phase = 'assess';
    st.createdAt = Date.now();
    st.assess = { total: ASSESS_TOTAL, asked: 0 };
    st.qa = { messages: [] };
    store.setStudy(st);
    this.syncFromStore();
    this.sendStudy('请开始摸底测评，出第一题。', { asked: 0, total: ASSESS_TOTAL });
  },

  // ---------- 发送 ----------
  onInput(e) { this.setData({ input: e.detail.value }); },

  sendInput() {
    const text = this.data.input.trim();
    if (!text || !this.data.inputEnabled || this.data.sending) return;
    this.setData({ input: '' });
    this.sendStudy(text);
  },

  pickOption(e) {
    if (this.data.sending) return;
    const { i, text } = e.currentTarget.dataset;
    const label = String.fromCharCode(65 + Number(i)) + '. ' + text;
    this.sendStudy('学生的选择：' + label);
  },

  sendStudy(userText, extra) {
    if (this.data.sending) return;
    const st = this.st || store.getStudy();
    // 摸底最后一题时提示 AI 出计划
    if (st.phase === 'assess' && st.assess) {
      st.assess.asked += 1;
      if (st.assess.asked >= st.assess.total) {
        userText += '\n（系统提示：这是最后一道摸底题。请基于学生全部答题表现在 plan 里给出学习计划，从书架章节中选择，不要再出题。）';
      }
    }

    const pushMsg = (arr, m) => { arr.push(m); return m; };
    const myMsg = pushMsg(this.data.msgs, {
      id: 'x' + Date.now(), role: 'me', text: userText, q: null, time: Date.now()
    });
    this.setData({ msgs: this.data.msgs, sending: true });
    this.scrollToBottom();

    const history = (st.qa && st.qa.messages ? st.qa.messages : [])
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));

    ai.studyChat({
      phase: st.phase,
      profile: st.profile,
      bookshelf: this.buildBookshelf(),
      history,
      userMsg: userText,
      extra: { asked: st.assess ? st.assess.asked : 0, total: st.assess ? st.assess.total : ASSESS_TOTAL }
    })
      .then((res) => {
        // 校验 plan 引用的章节真实存在
        if (res.plan && Array.isArray(res.plan.chapters)) {
          const valid = [];
          res.plan.chapters.forEach((c) => {
            const b = store.getBook(c.bookId);
            if (b && b.chapters && b.chapters.some((x) => x.id === c.chapterId)) {
              valid.push({ bookId: c.bookId, chapterId: c.chapterId, title: c.title || '', done: false });
            }
          });
          res.plan.chapters = valid;
        }

        // 持久化
        const st2 = store.getStudy();
        st2.qa = st2.qa || { messages: [] };
        st2.qa.messages.push({ role: 'user', content: userText, ts: Date.now() });
        st2.qa.messages.push({
          role: 'assistant',
          content: JSON.stringify({ reply: res.reply, question: res.question }),
          ts: Date.now()
        });
        if (res.memory) st2.profile = res.memory;
        if (res.plan && res.plan.chapters && res.plan.chapters.length) {
          st2.plan = { text: res.plan.text || '', chapters: res.plan.chapters, createdAt: Date.now() };
          st2.phase = 'reading';
        }
        store.setStudy(st2);

        // 界面
        const aiMsg = {
          id: 'x' + Date.now() + 'r',
          role: 'ai',
          text: res.reply,
          q: res.question && res.question.title ? res.question : null,
          time: Date.now()
        };
        this.setData({ msgs: this.data.msgs.concat([aiMsg]), sending: false });
        this.st = st2;
        this.syncFromStore();
      })
      .catch((err) => {
        this.setData({ sending: false });
        wx.showModal({ title: '请求失败', content: err.message || '请稍后重试', showCancel: false });
      });
  },

  // ---------- 阅读任务 ----------
  goRead(e) {
    const { book, chapter } = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/reader/reader?bookId=' + book + '&chapterId=' + chapter });
  },

  goQuiz(e) {
    const { book, chapter } = e.currentTarget.dataset;
    wx.navigateTo({ url: '/pages/quiz/quiz?bookId=' + book + '&chapterId=' + chapter });
  },

  // 全部章节闯关完成 → 解锁问答
  startQA() {
    const st = store.getStudy();
    if (!st.plan || !st.plan.chapters.length) return;
    const allDone = st.plan.chapters.every((c) => c.done);
    if (!allDone) return wx.showToast({ title: '还有章节未完成闯关', icon: 'none' });
    st.phase = 'qa';
    store.setStudy(st);
    this.syncFromStore();
    this.sendStudy('阅读任务的章节闯关已全部完成，请开始针对我读过的章节提问（每次一题，题型可以是填空或简答）。');
  },

  resetAll() {
    wx.showModal({
      title: '重置学习进度',
      content: '清空摸底结果、学习计划与全部 AI 对话记忆？',
      confirmText: '重置',
      confirmColor: '#E24B4A',
      success: (res) => {
        if (!res.confirm) return;
        store.resetStudy();
        this.syncFromStore();
        wx.showToast({ title: '已重置', icon: 'none' });
      }
    });
  }
});
