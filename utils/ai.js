// utils/ai.js —— 轻量 AI 任务（硅基流动）：词表提取 / 批量句译 / 学习 Agent
// 与 utils/llm.js（DeepSeek 精读问答）互补：批量、便宜的任务走这里

const store = require('./store');

const parseJSON = (text) => {
  try { return JSON.parse(text); } catch (e) {}
  const m = String(text).match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  throw new Error('AI 返回内容解析失败，请重试');
};

// 硅基流动通用对话（OpenAI 兼容）
// opts: {messages, model?, json?, temperature?, maxTokens?}
const sfChat = (opts) =>
  new Promise((resolve, reject) => {
    const s = store.getSettings();
    if (!s.sfApiKey) return reject(new Error('请先在「系统设置」配置硅基流动 API Key'));
    wx.request({
      url: s.sfBaseUrl.replace(/\/+$/, '') + '/chat/completions',
      method: 'POST',
      timeout: 120000,
      header: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + s.sfApiKey
      },
      data: {
        model: opts.model || s.sfModel,
        temperature: opts.temperature != null ? opts.temperature : 0.3,
        max_tokens: opts.maxTokens || 4096,
        messages: opts.messages,
        response_format: opts.json ? { type: 'json_object' } : undefined
      },
      success: (res) => {
        if (res.statusCode !== 200) {
          const msg =
            (res.data && res.data.error && res.data.error.message) ||
            (res.data && res.data.message) ||
            ('HTTP ' + res.statusCode);
          return reject(new Error('API 错误：' + msg));
        }
        try {
          resolve(res.data.choices[0].message.content);
        } catch (e) {
          reject(new Error('API 返回格式异常'));
        }
      },
      fail: () => reject(new Error('网络请求失败，请检查网络，或在开发者工具中勾选「不校验合法域名」'))
    });
  });

// ---------- 章节词表提取 ----------
// 输入章节正文，输出固定 JSON：{"words":[{"word":"...","meaning":"中文释义"}]}
const extractWords = (content) =>
  sfChat({
    json: true,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          '你是英语教材编辑。从用户给出的英文章节正文中提取「值得学习的单词和短语」。\n' +
          '要求：\n' +
          '1. 覆盖实词为主（生僻词、短语搭配、习语优先），跳过 the/is/and 等基础功能词\n' +
          '2. 短语按原文出现形式提取（如 "give up"、"be fond of"）\n' +
          '3. 单词归为原形/单数形式，meaning 给出最常用中文释义（含词性，如 "n. 苹果"）\n' +
          '4. 数量 15-40 个，按在文中出现顺序\n' +
          '只输出严格 JSON：{"words":[{"word":"英文","meaning":"中文释义"}]}'
      },
      { role: 'user', content: String(content || '').slice(0, 12000) }
    ]
  }).then((out) => {
    const r = parseJSON(out);
    const words = (r.words || [])
      .map((x) => ({ word: String(x.word || '').trim(), meaning: String(x.meaning || '').trim() }))
      .filter((x) => x.word);
    if (!words.length) throw new Error('未能提取到词表，请重试');
    return words;
  });

// ---------- 批量句译 ----------
// sentences: string[]；返回与输入等长的中文翻译数组（错位/缺失时回退为空串）
const PROMPT_TRANS =
  '你是专业英中翻译。用户会用编号列表给出多个英文句子，请逐句翻译成通顺的中文。\n' +
  '只输出严格 JSON：{"translations":["第1句翻译","第2句翻译",...]}，数组长度必须与输入句数一致，不要合并或遗漏。';

const batchTranslate = (sentences) => {
  const list = sentences.map((s, i) => i + 1 + '. ' + s);
  return sfChat({
    json: true,
    temperature: 0.2,
    maxTokens: 8192,
    messages: [
      { role: 'system', content: PROMPT_TRANS },
      { role: 'user', content: list.join('\n') }
    ]
  }).then((out) => {
    const r = parseJSON(out);
    const arr = Array.isArray(r.translations) ? r.translations : [];
    // 长度对不齐时按位兜底，保证与输入等长
    return sentences.map((_, i) => (typeof arr[i] === 'string' ? arr[i] : ''));
  });
};

// 长章节分批翻译（每批 8 句），进度回调 onProgress(done, total)
const translateAll = async (sentences, onProgress) => {
  const out = new Array(sentences.length).fill('');
  const SIZE = 8;
  let done = 0;
  for (let i = 0; i < sentences.length; i += SIZE) {
    const batch = sentences.slice(i, i + SIZE);
    try {
      const tr = await batchTranslate(batch);
      tr.forEach((t, j) => (out[i + j] = t));
    } catch (e) {
      // 单批失败不阻塞整体，留下空串可日后重试
    }
    done += batch.length;
    if (onProgress) onProgress(done, sentences.length);
  }
  return out;
};

// 生词释义批量补齐（闯关前把缺释义的词补上）
const fillMeanings = async (words) => {
  const missing = words.filter((w) => !w.translation && !w.meaning);
  if (!missing.length) return words;
  const list = missing.map((w, i) => i + 1 + '. ' + w.word);
  let map = {};
  try {
    const out = await sfChat({
      json: true,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            '你是英语词典。对用户列表中的每个单词/短语给出最常用中文释义（含词性，如 "v. 放弃"）。\n' +
            '只输出严格 JSON：{"meanings":[{"word":"原文","meaning":"释义"}]}，数量与输入一致。'
        },
        { role: 'user', content: list.join('\n') }
      ]
    });
    const r = parseJSON(out);
    (r.meanings || []).forEach((m) => {
      if (m && m.word) map[String(m.word).toLowerCase()] = String(m.meaning || '');
    });
  } catch (e) {
    return words; // 失败不阻塞，缺释义的词闯关里跳过选项
  }
  return words.map((w) => {
    if (w.translation || w.meaning) return w;
    const m = map[w.word.toLowerCase()];
    return m ? Object.assign({}, w, { translation: m }) : w;
  });
};

// ---------- 学习 Agent ----------
// 协议：客户端拼装系统提示 + 历史摘要 + 学习者画像，AI 返回严格 JSON：
// {
//   reply: "给学生看的文字（讲解/反馈/引导）",
//   question: {type:"choice", title, options:[...4个], answer: 0-3, explain} |
//             {type:"input", title, answer:"参考答案", explain} | null,
//   memory: "学习者画像更新（累计要点，每次全量覆盖）" | null,
//   plan: {text:"学习计划说明", chapters:[{bookId,chapterId,title}]} | null
// }
const STUDY_SYSTEM =
  '你是私人英语学习教练 App 内的 AI 引擎，与学生在小程序里交互。学生书架里已有书籍（章节列表会提供给你）。\n' +
  '工作流程（客户端控制阶段，你在每轮响应里遵循）：\n' +
  '1. 摸底阶段（phase=assess）：学生英语水平未知，你需要逐步出题了解水平。每次只出 1 道英语四选一选择题（覆盖词汇/语法/阅读理解，难度从易到难动态调整）。学生答完你判对错、简短点评，再出下一题。\n' +
  '2. 出计划（phase=plan-end）：摸底题数达到客户端指示的数量后，基于答题表现给出学习计划：从书架章节里挑选适合他水平的章节作为阅读任务（书架章节以 id 列表提供，必须原样引用 id），plan.chapters 按Recommended阅读顺序返回。\n' +
  '3. 阅读任务阶段（phase=reading）：学生去阅读并完成章节单词闯关，此时你不发新题，只做简短回应；客户端会在学生完成闯关后通知你。\n' +
  '4. 问答阶段（phase=qa）：针对学生读过的章节内容，每次只出 1 道题考察语法/词义/理解。type=input 的题目可以是填空题（answer 是参考答案）或简答主观题。学生作答后你判对错、讲解，再出下一题。\n' +
  '通用要求：\n' +
  '- 每次响应只输出严格 JSON，不要多余文本：{"reply":"给学生的文字（中文，简洁友好）","question": 题目对象或 null,"memory":"学习者画像（词汇量/语法弱项/阅读偏好，累计全量，150字内）","plan": 计划对象或 null}\n' +
  '- question.type="choice" 时 options 必须恰好 4 个字符串，answer 是正确项下标(0-3)\n' +
  '- question.type="input" 时 answer 是参考答案字符串\n' +
  '- 非出题场景（答疑、闲聊、讲解）question 为 null\n' +
  '- memory 每次都返回完整的最新画像';

// 组装学习 Agent 消息（history: [{role:'user'|'assistant', content}]，content 为 JSON 字符串或纯文本）
const studyChat = async ({ phase, profile, bookshelf, history, userMsg, extra }) => {
  const sys =
    STUDY_SYSTEM +
    '\n\n当前 phase=' + phase +
    (phase === 'assess'
      ? '（摸底中：出第 ' + ((extra && extra.asked || 0) + 1) + ' 题；总题数 ' + ((extra && extra.total) || 24) + '，到达后改出 plan 不再出题）'
      : '') +
    '\n学习者画像：' + (profile || '（暂无，第一次见这个学生）') +
    '\n书架章节（plan.chapters 必须从这里选，id 原样引用）：\n' +
    (bookshelf || '（书架空）');
  const messages = [{ role: 'system', content: sys }].concat(history || []);
  messages.push({ role: 'user', content: userMsg });
  const out = await sfChat({
    json: true,
    temperature: 0.5,
    maxTokens: 8192,
    messages
  });
  const r = parseJSON(out);
  return {
    reply: String(r.reply || ''),
    question: r.question || null,
    memory: typeof r.memory === 'string' ? r.memory : null,
    plan: r.plan || null
  };
};

module.exports = { sfChat, parseJSON, extractWords, batchTranslate, translateAll, fillMeanings, studyChat };
