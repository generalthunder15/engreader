// utils/tts.js —— 语音朗读：免费在线 TTS 接口 + 本地文件缓存 + 全局单播放器
// 不依赖任何插件/后台配置；音频首次播放后缓存到用户目录，同一文本再次朗读 0 请求
// 注意：个人使用需在开发者工具勾选「不校验合法域名」；体验版真机使用需打开调试
const store = require('./store');
const { hash } = require('./tokenize');

// 免费英文 TTS 接口（无需鉴权），spd 为语速 1~9
const TTS_API = 'https://fanyi.baidu.com/gettts?lan=en&source=web&';

let audio = null;        // 全局唯一播放器，避免声音重叠
let playingText = '';    // 当前正在朗读的文本（空串 = 未播放）

const ctx = () => {
  if (!audio) {
    audio = wx.createInnerAudioContext();
    audio.obeyMuteSwitch = false;
  }
  return audio;
};

// 本地缓存文件路径（语速参与 hash：同一文本不同语速分别缓存）
function cachePath(text, speed) {
  return wx.env.USER_DATA_PATH + '/tts_' + hash(String(text) + '|' + speed) + '.mp3';
}

const fs = () => wx.getFileSystemManager();

// 下载/合成的音频写入缓存并返回路径（失败返回 null，由调用方用临时数据兜底）
function saveBuffer(buf, path) {
  try {
    fs().writeFileSync(path, buf, 'binary');
    return path;
  } catch (e) {
    return null;
  }
}

// ---------- 方案 A：硅基流动 CosyVoice2（质量最好，需在「我的」页配置 TTS Key） ----------
function synthSilicon(text, path, speed) {
  return new Promise((resolve, reject) => {
    const s = store.getSettings();
    wx.request({
      url: 'https://api.siliconflow.cn/v1/audio/speech',
      method: 'POST',
      timeout: 20000,
      responseType: 'arraybuffer',
      header: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + s.ttsApiKey
      },
      data: {
        model: 'FunAudioLLM/CosyVoice2-0.5B',
        input: String(text).slice(0, 600),
        voice: 'FunAudioLLM/CosyVoice2-0.5B:claire',
        response_format: 'mp3',
        speed: Math.min(4, Math.max(0.25, Number(speed) || 1)) // CosyVoice2 允许 0.25~4
      },
      success: (res) => {
        // 音频二进制较长；错误时返回的是 JSON 文本，字节数很小
        if (res.statusCode !== 200 || !res.data || res.data.byteLength < 1000) {
          return reject(new Error('TTS 服务不可用(' + res.statusCode + ')'));
        }
        resolve(saveBuffer(res.data, path) || null);
      },
      fail: () => reject(new Error('TTS 网络请求失败'))
    });
  });
}

// ---------- 方案 B：免费合成接口（无需配置，默认走这条） ----------
// 语速映射：设置 0.5~2 → 百度 spd 1~9（3 为正常语速）
function synthFree(text, path, speed) {
  const spd = Math.min(9, Math.max(1, Math.round(3 * (Number(speed) || 1))));
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: TTS_API + 'spd=' + spd + '&text=' + encodeURIComponent(String(text).slice(0, 600)),
      timeout: 15000,
      success: (res) => {
        const type = (res.header && (res.header['Content-Type'] || res.header['content-type'])) || '';
        if (res.statusCode !== 200 || type.indexOf('audio') === -1) {
          return reject(new Error('朗读服务暂不可用，请稍后重试'));
        }
        try {
          fs().copyFileSync(res.tempFilePath, path);
          resolve(path);
        } catch (e) {
          // 保存失败不影响本次播放，直接用临时文件
          resolve(res.tempFilePath);
        }
      },
      fail: () => reject(new Error('朗读请求失败，请检查网络'))
    });
  });
}

// 已缓存则返回本地路径，否则合成并保存后返回
function fetchTts(text) {
  return new Promise((resolve, reject) => {
    const path = cachePath(text);
    try {
      fs().accessSync(path);
      return resolve(path); // 命中本地缓存
    } catch (e) { /* 未缓存，继续合成 */ }

    const s = store.getSettings();
    const task = s.ttsApiKey
      ? synthSilicon(text, path).catch(() => synthFree(text, path)) // 硅基流动失败降级免费接口
      : synthFree(text, path);
    task.then((p) => (p ? resolve(p) : reject(new Error('音频保存失败')))).catch(reject);
  });
}

/**
 * 朗读一段英文文本
 * @returns Promise<void> 播放自然结束时 resolve
 */
function play(text) {
  return new Promise((resolve, reject) => {
    stop();
    playingText = text;
    const a = ctx();

    a.onEnded(() => { if (playingText === text) { playingText = ''; resolve(); } });
    a.onError(() => {
      if (playingText !== text) return;
      // 本地缓存可能损坏：删除后重试一次
      try { fs().unlinkSync(cachePath(text, store.getSettings().ttsSpeed || 1)); } catch (e) {}
      fetchTts(text)
        .then((src) => {
          if (playingText !== text) return;
          a.src = src;
          a.play();
        })
        .catch((err) => { playingText = ''; reject(err); });
    });

    fetchTts(text)
      .then((src) => {
        if (playingText !== text) return;
        a.src = src;
        a.play();
      })
      .catch((err) => { playingText = ''; reject(err); });
  });
}

/**
 * 直接播放一个音频 URL（如词典真人发音）
 * @returns Promise<void> 播放自然结束时 resolve
 */
function playUrl(url) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error('无音频地址'));
    stop();
    playingText = '@url:' + url;
    const a = ctx();
    a.onEnded(() => { if (playingText === '@url:' + url) { playingText = ''; resolve(); } });
    a.onError(() => { if (playingText === '@url:' + url) { playingText = ''; reject(new Error('播放失败')); } });
    a.src = url;
    a.play();
  });
}

function stop() {
  playingText = '';
  if (audio) { try { audio.stop(); } catch (e) {} }
}

module.exports = { play, playUrl, stop, isPlaying: (t) => !!playingText && (!t || playingText === t) };
