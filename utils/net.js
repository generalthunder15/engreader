// utils/net.js —— 网络诊断与域名提示（小程序 request 合法域名的坑集中在这里处理）

// 本项目用到的全部外部域名
// icp: true = 国内已备案域名，可以填进 mp 后台 request 合法域名
// icp: false = 境外域名，个人/正式版基本配不进白名单，只能靠开发调试或本地兜底
const DOMAINS = [
  { host: 'api.deepseek.com', use: 'AI 翻译 / 句译 / 语法解析 / 学习教练', icp: true, probe: 'https://api.deepseek.com/models' },
  { host: 'dict.youdao.com', use: '单词释义 / 真人发音', icp: true, probe: 'https://dict.youdao.com/jsonapi?jsonversion=2&client=mobile&dicts=%7B%22count%22%3A1%2C%22dicts%22%3A%5B%5B%22ec%22%5D%5D%7D&q=good' },
  // 境外备源：实测响应可达 20s，且真机正式版无法放行，不通/超时都不算故障
  { host: 'api.dictionaryapi.dev', use: '单词释义备源（境外，正式版不可用）', optional: true, icp: false, timeout: 8000, probe: 'https://api.dictionaryapi.dev/api/v2/entries/en/good' }
];

// 纯域名清单：给「复制域名清单」用，可直接粘进 mp 后台
const DOMAIN_TEXT = DOMAINS.filter((d) => d.icp !== false).map((d) => d.host).join('\n');
// 带说明的清单：给自检展示用
const DOMAIN_DETAIL = DOMAINS
  .map((d) => d.host + (d.icp === false ? '（境外域名，正式版配不进白名单）' : ''))
  .join('\n');

// 把 wx.request 的 fail 错误翻译成可执行的操作指引
const hint = (err) => {
  const msg = (err && err.errMsg) || '';
  if (msg.indexOf('domain') !== -1 || msg.indexOf('url not in') !== -1) {
    return (
      '微信拦截了本次请求（域名未放行，请求没发出去，与 API Key 和网络无关）。\n\n' +
      '开发者工具：详情 → 本地设置 → 勾选「不校验合法域名」。\n' +
      '真机预览：右上角「···」→ 打开「开发调试」→ 重进小程序。\n' +
      '正式版：mp 后台配 request 合法域名（域名须已 ICP 备案，境外域名配不了）。\n' +
      '都不行：打开「本地兜底」开关，内置书仍可离线阅读。'
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
      timeout: d.timeout || 10000,
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

module.exports = { DOMAINS, DOMAIN_TEXT, DOMAIN_DETAIL, hint, probe, diagnose };
