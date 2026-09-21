// utils/tokenize.js —— 文章分词（导入时预处理，供阅读器逐词渲染）

const hash = require('./store.js').hash;

// 不表示句末的常见缩写（Mr. / Dr. / etc. …）
const ABBR = {
  mr: 1, mrs: 1, ms: 1, dr: 1, prof: 1, st: 1, jr: 1, sr: 1, vs: 1, etc: 1,
  eg: 1, ie: 1, no: 1, fig: 1, inc: 1, ltd: 1, co: 1, corp: 1, gen: 1, col: 1,
  capt: 1, sgt: 1, rev: 1, hon: 1, approx: 1, dept: 1, vol: 1, pp: 1, al: 1,
  cf: 1, ed: 1, eds: 1, gov: 1, sen: 1, rep: 1, univ: 1, bros: 1, est: 1
};

// 判断 text[i] 处的 '.' 是否「不是句末」：小数 3.14、缩写 U.S./Mr.、单字母缩写 A.
function isNonStopDot(text, i) {
  const prev = text[i - 1] || '';
  const next = text[i + 1] || '';
  if (/\d/.test(prev) && /\d/.test(next)) return true; // 小数
  const m = text.slice(0, i).match(/([A-Za-z]+)$/);
  if (!m) return false;
  const w = m[1];
  if (w.length === 1) return true;                     // U. / A.
  if (ABBR[w.toLowerCase()]) return true;              // Mr. / etc.
  const before = text[i - w.length - 1];               // U.S.（后段是 1-2 个字母且前面还有点）
  if (before === '.' && w.length <= 2) return true;
  return false;
}

/**
 * 切句：遇到每个 "." 强制断句（缩写/小数除外），?!… 同理
 * 收尾的引号、右括号跟随上一句，不单独成句
 */
function splitSentences(para) {
  const text = String(para == null ? '' : para).replace(/\s+/g, ' ').trim();
  if (!text) return [];
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c !== '.' && c !== '!' && c !== '?' && c !== '…') continue;
    if (c === '.' && isNonStopDot(text, i)) continue;
    let j = i; // 连续标点（?! / ...）一并吞掉
    while (j + 1 < text.length && /[.!?…]/.test(text[j + 1])) j++;
    while (j + 1 < text.length && /["'”’)\]]/.test(text[j + 1])) j++; // 跟随的收尾引号
    const seg = text.slice(start, j + 1).trim();
    if (seg) out.push(seg);
    start = j + 1;
    i = j;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail); // 末尾没有标点的残句也保留
  return out;
}

// 切词：英文单词（含撇号/连字符）、数字、其余每个标点单独成 token
function splitWords(sentence) {
  return sentence.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,]\d+)*|[^\sA-Za-z0-9]/g) || [];
}

/**
 * 将整篇文章文本转为结构化数据
 * 分段规则：每个句子独立成段（遇到 "." 强制换行），段与段之间在阅读器里留出间距
 * @returns {title, paragraphs: [{pid, tokens: [{id, w, sid}]}], sentences: [text], tokenCount}
 * id: 全文 token 唯一序号；sid: 全文句子唯一序号
 */
function tokenizeArticle(title, content) {
  // 先按输入的换行切块（保留作者的分段意图），块内再逐句断段
  const blocks = String(content || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const paragraphs = [];
  const sentences = [];
  let tid = 0;
  let sid = 0;

  blocks.forEach((block) => {
    splitSentences(block).forEach((s) => {
      const mySid = sid++;
      sentences[mySid] = s;
      const toks = splitWords(s).map((w) => ({ id: tid++, w, sid: mySid }));
      if (toks.length) paragraphs.push({ pid: paragraphs.length, tokens: toks });
    });
  });

  return { title, paragraphs, sentences, tokenCount: tid, splitVer: 2 };
}

// 恢复一段区间的原文（智能处理标点空格）
function joinTokens(tokens) {
  const out = [];
  tokens.forEach((t) => {
    if (!out.length) { out.push(t.w); return; }
    if (/^[,.!?;:%…'")\]”’]+$/.test(t.w)) {
      out[out.length - 1] += t.w;                       // 标点跟紧前词
    } else if (/^[('“\[]+$/.test(out[out.length - 1])) {
      out[out.length - 1] += t.w;                       // 前词是左括号/引号
    } else if (/^[('“\[]+$/.test(t.w)) {
      out.push(t.w);                                    // 左括号后正常空格
    } else {
      out.push(t.w);
    }
  });
  return out.join(' ').replace(/\s+([,.!?;:%])/g, '$1');
}

// 相邻两个 token 之间是否需要空格（与 joinTokens 的规则保持一致）
const TIGHT_AFTER = /^[,.!?;:%…'")\]”’]+$/; // 紧跟在前词后的标点
const OPEN_END = /^[('“\[]+$/;               // 后面不空格的左括号/引号

function needsSpace(prev, next) {
  if (!prev || !next) return false;
  if (TIGHT_AFTER.test(next.w)) return false; // 标点前不空格
  if (OPEN_END.test(prev.w)) return false;    // 左括号后不空格
  return true;
}

/**
 * 给每个 token 标注「其后是否有空格」(sp)
 * 阅读器据此把词间距渲染成独立的填充元素，避免高亮/选中时把空格一起选中
 */
function decorateSpacing(paragraphs) {
  return (paragraphs || []).map((para) => {
    const src = para.tokens || [];
    const tokens = src.map((t, i) => Object.assign({}, t, { sp: needsSpace(t, src[i + 1]) }));
    return Object.assign({}, para, { tokens });
  });
}

module.exports = { hash, tokenizeArticle, splitSentences, splitWords, joinTokens, decorateSpacing };
