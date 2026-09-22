// utils/llm.js —— 客户端直连大模型（OpenAI 兼容协议），带本地永久缓存
const store = require('./store');
const { hash } = require('./tokenize');
const { hint: netHint } = require('./net');

const PROMPTS = {
  word: () =>
    '你是专业的英语学习助手。用户会给出一个英语单词或短语，请返回严格的 JSON（不要输出任何多余文本）：\n' +
    '{"translation":"最常用的中文释义","phonetic":"英式音标，如 /əˈbaʊt/","pos":"词性，如 n. / v. / adj.","senses":["其他常用义项，最多3条"],"example":"包含该词的简短英文例句","exampleTranslation":"例句的中文翻译"}',
  sentence: () =>
    '你是专业的英语语法老师。用户会给出一个英语句子，请返回严格的 JSON（不要输出任何多余文本）：\n' +
    '{"translation":"整句通顺的中文翻译","grammar":{"structure":"句子主干结构说明，如：主语 + that 引导的定语从句 + 谓语 + 宾语","clauses":[{"text":"从句或复杂成分原文","type":"从句类型，如定语从句","explain":"它的作用与翻译要点"}],"phrases":[{"text":"句中固定短语或搭配","explain":"含义与用法"}],"difficultPoints":"本句难点、易错点、值得积累的表达"}}',
  sentenceDetail: () =>
    '你是专业的英语精读老师。用户会给出一个英语句子，请从单词、短语到语法逐层拆解，返回严格的 JSON（不要输出任何多余文本）：\n' +
    '{"translation":"整句通顺的中文翻译",' +
    '"structure":"整句成分总览，用【】标注成分，如：【主语 Habit】+【系动词 are】+【表语 the compound interest…】",' +
    '"words":[{"word":"句中单词（按出现顺序，覆盖所有实词）","meaning":"该词在句中的中文含义及词性","note":"在句中充当的成分或形式变化，如：谓语动词第三人称单数 / 过去分词作后置定语"}],' +
    '"phrases":[{"text":"短语或固定搭配","meaning":"中文含义","usage":"用法说明，如何时用、和什么介词搭配"}],' +
    '"grammar":[{"point":"语法点名称，如：that 引导的表语从句","explain":"该语法点在本句中的具体体现与作用","example":"一个类似结构的英文例句"}],' +
    '"summary":"一句话点出本句最值得学习的 1-2 个语言点"}',
  textAsk: () =>
    '你是耐心的英语私教。用户会提供一段英语原文和一个针对它的问题。请用中文回答：\n' +
    '- 准确、简洁、有条理，重点先行\n- 解释语法/词汇时引用原文对应的英文\n- 需要分点时用「1. 2. 3.」编号\n- 直接回答，不要输出 JSON，不要复述原文',
  suggestQ: () =>
    '你是英语老师。用户会给出一段英语原文，请针对其中最值得学习的 1-3 个点（语法、词汇用法、含义辨析），生成 3 个学习者最可能问的问题。\n' +
    '返回严格的 JSON（不要输出任何多余文本）：{"questions":["问题1","问题2","问题3"]}\n' +
    '要求：问题用中文、不超过 15 个字、各不相同、直接可问（如「为什么用过去完成时？」）'
};

function parseJSON(text) {
  try { return JSON.parse(text); } catch (e) {}
  const m = String(text).match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
  throw new Error('AI 返回内容解析失败，请重试');
}

/**
 * 查询 AI（单词/整句）
 * @param {{type:'word'|'sentence', text:string}} opts
 * @returns Promise<{fromCache:boolean, type:string, text:string, result:object}>
 */
const ask = ({ type, text, question }) =>
  new Promise((resolve, reject) => {
    if (!text || !text.trim()) return reject(new Error('未选中文本'));
    const VALID = ['word', 'sentence', 'sentenceDetail', 'textAsk', 'suggestQ'];
    const t = VALID.indexOf(type) !== -1 ? type : 'word';
    const content = text.trim();
    const q = String(t === 'textAsk' ? question || '' : '').trim();
    if (t === 'textAsk' && !q) return reject(new Error('请先输入问题'));

    const s = store.getSettings();
    if (!s.apiKey) {
      return reject(new Error('请先在「我的」页配置大模型 API Key'));
    }

    // 本地缓存命中：同一句/词/问题永久免费、零延迟
    const key = hash(t + ':' + content.toLowerCase() + ':' + q);
    const cache = store.getAICache();
    if (cache[key]) return resolve({ fromCache: true, type: t, text: content, result: cache[key] });

    wx.request({
      url: s.baseUrl.replace(/\/+$/, '') + '/chat/completions',
      method: 'POST',
      timeout: 60000,
      header: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + s.apiKey
      },
      data: Object.assign(
        {
          model: s.model,
          temperature: 0.3,
          messages: [
            { role: 'system', content: PROMPTS[t]() },
            { role: 'user', content: t === 'textAsk' ? '原文：' + content + '\n\n问题：' + q : content }
          ]
        },
        // DeepSeek V4 默认开启思考模式（慢），查词/翻译场景显式关闭
        s.baseUrl.indexOf('deepseek') !== -1 ? { thinking: { type: 'disabled' } } : {}
      ),
      success: (res) => {
        if (res.statusCode !== 200) {
          const msg =
            (res.data && res.data.error && res.data.error.message) ||
            (res.data && res.data.message) ||
            ('HTTP ' + res.statusCode);
          return reject(new Error('API 错误：' + msg));
        }
        let contentStr = '';
        try {
          contentStr = res.data.choices[0].message.content;
        } catch (e) {
          return reject(new Error('API 返回格式异常'));
        }
        try {
          // 自由问答返回纯文本，其余类型解析 JSON
          const result = t === 'textAsk' ? contentStr.trim() : parseJSON(contentStr);
          store.putAICache(key, result);
          resolve({ fromCache: false, type: t, text: content, result });
        } catch (e) {
          reject(e);
        }
      },
      fail: (err) => reject(new Error(netHint(err)))
    });
  });

module.exports = { ask };
