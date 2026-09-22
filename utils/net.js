// utils/net.js —— 网络诊断与域名提示（小程序 request 合法域名的坑集中在这里处理）

// 本项目用到的全部外部域名（真机需逐个加入 mp 后台 request 合法域名）
const DOMAINS = [
  { host: 'api.deepseek.com', use: 'AI 翻译 / 句译 / 语法解析 / 学习教练', probe: 'https://api.deepseek.com/models' },
  { host: 'dict.youdao.com', use: '单词释义 / 真人发音', probe: 'https://dict.youdao.com/jsonapi?jsonversion=2&client=mobile&dicts=%7B%22count%22%3A1%2C%22dicts%22%3A%5B%5B%22ec%22%5D%5D%7D&q=good' },
  { host: 'api.dictionaryapi.dev', use: '单词释义备源', probe: 'https://api.dictionaryapi.dev/api/v2/entries/en/good' }
];

const DOMAIN_TEXT = DOMAINS.map((d) => d.host).join('\n');

// 把 wx.request 的 fail 错误翻译成可执行的操作指引
const hint = (err) => {
  const msg = (err && err.errMsg) || '';
  if (msg.indexOf('domain') !== -1 || msg.indexOf('url not in') !== -1) {
    return (
      '当前域名未加入小程序白名单。\n\n' +
      '真机：点小程序右上角「···」→ 打开「开发调试」→ 重进小程序即可临时放行。\n' +
      '开发者工具：详情 → 本地设置 → 勾选「不校验合法域名」。\n' +
      '长期方案：mp 后台「开发管理 → 服务器域名 → request 合法域名」加入：\n' +
      DOMAIN_TEXT
    );
  }
  if (msg.indexOf('timeout') !== -1) return '请求超时，请检查网络后重试。';
  return '网络请求失败：' + (msg || '请检查网络');
};

// 单个域名探测（只关心能不能通，不关心内容）
const probe = (d) =>
  new Promise((resolve) => {
    const t0 = Date.now();
    wx.request({
      url: d.probe,
      method: 'GET',
      timeout: 10000,
      success: (res) => {
        // 401 也说明网络通（域名已放行，只是没带 Key）
        const reachable = res.statusCode < 500;
        resolve({ host: d.host, use: d.use, ok: reachable, ms: Date.now() - t0, code: res.statusCode });
      },
      fail: (err) => {
        const msg = (err && err.errMsg) || '';
        const blocked = msg.indexOf('domain') !== -1 || msg.indexOf('url not in') !== -1;
        resolve({ host: d.host, use: d.use, ok: false, ms: Date.now() - t0, code: blocked ? '域名未放行' : '网络失败' });
      }
    });
  });

// 全量自检：返回每个域名的连通性
const diagnose = () => Promise.all(DOMAINS.map(probe));

module.exports = { DOMAINS, DOMAIN_TEXT, hint, probe, diagnose };
