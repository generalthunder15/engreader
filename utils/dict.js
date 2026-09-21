// utils/dict.js —— 在线词典查询（免 Key、标准 JSON，无需 AI）
// 主源：有道词典 jsonapi「ec」词典（中文释义 + 英美音标 + 词形变化，个人使用非官方接口）
// 备源：Free Dictionary API（dictionaryapi.dev，英文释义），两者都失败再降级 AI
const store = require('./store');

const isWord = (w) => /^[A-Za-z][A-Za-z'’-]*$/.test(String(w || '').trim());

const cacheKey = (w) => 'dict_' + store.hash(w.trim().toLowerCase());

// ---------- 主源：有道 jsonapi ----------
function youdao(word) {
  const url =
    'https://dict.youdao.com/jsonapi?jsonversion=2&client=mobile&dicts=' +
    encodeURIComponent('{"count":1,"dicts":[["ec"]]}') +
    '&q=' + encodeURIComponent(word);
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      timeout: 8000,
      success: (res) => {
        try {
          const ec = res.data && res.data.ec;
          // ec.word 可能是数组（正常词目）或对象（兜底）
          const w0 = Array.isArray(ec.word) ? ec.word[0] : ec.word;
          if (!w0 || !Array.isArray(w0.trs)) return reject(new Error('dict miss'));

          // 释义：trs: [{tr: [{l: {i: ["n. 习惯", ...]}}]}] 拍平
          const senses = [];
          w0.trs.forEach((t) => (t.tr || []).forEach((x) => {
            const arr = x.l && x.l.i;
            if (!Array.isArray(arr)) return;
            arr.forEach((item) => {
              if (typeof item === 'string' && item.trim()) senses.push(item.trim());
            });
          }));
          if (!senses.length) return reject(new Error('dict empty'));

          // 词形变化（复数/时态等）追加到义项末尾
          (w0.wfs || []).forEach((wf) => {
            if (wf.wf && wf.wf.name && wf.wf.value) senses.push(wf.wf.name + '：' + wf.wf.value);
          });

          // 音标：英/美分别展示
          const ph = [];
          if (w0.ukphone) ph.push('英 /' + w0.ukphone + '/');
          if (w0.usphone) ph.push('美 /' + w0.usphone + '/');

          resolve({
            source: 'dict',
            translation: senses[0],
            senses: senses.slice(1, 10),
            phonetic: ph.join('  '),
            pos: '',
            example: '',
            exampleTranslation: ''
          });
        } catch (e) {
          reject(new Error('dict parse fail'));
        }
      },
      fail: () => reject(new Error('dict network fail'))
    });
  });
}

// ---------- 备源：Free Dictionary API（英文释义） ----------
function freeDict(word) {
  const url = 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word);
  return new Promise((resolve, reject) => {
    wx.request({
      url,
      timeout: 8000,
      success: (res) => {
        const entries = Array.isArray(res.data) ? res.data : [];
        if (!entries.length) return reject(new Error('dict miss'));
        const e0 = entries[0];
        const senses = [];
        entries.slice(0, 2).forEach((e) =>
          (e.meanings || []).forEach((m) =>
            (m.definitions || []).slice(0, 2).forEach((d) => {
              senses.push((m.partOfSpeech ? m.partOfSpeech + '. ' : '') + d.definition);
            })
          )
        );
        if (!senses.length) return reject(new Error('dict empty'));
        resolve({
          source: 'dict',
          translation: senses[0],
          senses: senses.slice(1, 8),
          phonetic: e0.phonetic || ((e0.phonetics || []).find((p) => p.text) || {}).text || '',
          pos: '',
          example: '',
          exampleTranslation: ''
        });
      },
      fail: () => reject(new Error('dict network fail'))
    });
  });
}

/**
 * 查询单词（本地缓存 → 有道 → Free Dictionary）
 * @returns Promise<result> 全部失败时 reject，由调用方降级 AI
 */
function lookup(word) {
  const w = String(word || '').trim();
  if (!isWord(w)) return Promise.reject(new Error('not a single word'));
  const key = cacheKey(w);
  const cached = store.get(key);
  if (cached) return Promise.resolve(cached);

  return youdao(w.toLowerCase())
    .catch(() => freeDict(w.toLowerCase()))
    .then((result) => {
      store.set(key, result); // 词典结果本地永久缓存，第二次查询 0 请求
      return result;
    });
}

// 真人发音音频地址（type=2 美音，type=1 英音）
function audioUrl(word, type = 2) {
  return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(String(word).trim()) + '&type=' + type;
}

module.exports = { lookup, audioUrl, isWord };
