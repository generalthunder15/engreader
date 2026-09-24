import { hash } from "../core/models";
import { settings } from "./storage";
import { request, networkError } from "./network";
import { audioUrl, isWord } from "./dictionary";
let generation = 0;
let player: WechatMiniprogram.InnerAudioContext | null = null;
let settle: (() => void) | null = null;
export function stop(): void {
  generation++;
  const active = player;
  player = null;
  if (active) {
    active.stop();
    active.destroy();
  }
  const done = settle;
  settle = null;
  done?.();
}
function playSource(src: string, ticket: number, playbackRate = 1): Promise<void> {
  if (ticket !== generation) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const audio = wx.createInnerAudioContext();
    player = audio;
    audio.obeyMuteSwitch = false;
    audio.playbackRate = playbackRate;
    const cleanup = (): void => {
      if (player === audio) {
        player = null;
        settle = null;
      }
      audio.destroy();
    };
    settle = resolve;
    audio.onEnded(() => {
      cleanup();
      resolve();
    });
    audio.onError(() => {
      cleanup();
      reject(new Error("音频播放失败，请重试"));
    });
    audio.src = src;
    audio.play();
  });
}
export function cachePath(
  text: string,
  speed: number,
  premium: boolean,
): string {
  return (
    wx.env.USER_DATA_PATH +
    "/tts_" +
    hash(JSON.stringify([text, speed, premium])) +
    ".mp3"
  );
}
async function synthesize(text: string): Promise<string> {
  const s = settings();
  const path = cachePath(text, s.ttsSpeed, !!s.ttsApiKey);
  const fs = wx.getFileSystemManager();
  try {
    fs.accessSync(path);
    return path;
  } catch {
    /* 尚未缓存 */
  }
  if (s.ttsApiKey) {
    try {
      const buffer = await request<ArrayBuffer>(
        "https://api.siliconflow.cn/v1/audio/speech",
        {
          method: "POST",
          key: s.ttsApiKey,
          responseType: "arraybuffer",
          data: {
            model: "FunAudioLLM/CosyVoice2-0.5B",
            input: text,
            voice: "FunAudioLLM/CosyVoice2-0.5B:claire",
            response_format: "mp3",
            speed: s.ttsSpeed,
          },
        },
      );
      if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 100)
        throw new Error("无有效音频");
      fs.writeFileSync(path, buffer, "binary");
      return path;
    } catch {
      /* 合成不可用时尝试免费音源 */
    }
  }
  return new Promise((resolve, reject) =>
    wx.downloadFile({
      url:
        "https://fanyi.baidu.com/gettts?lan=en&source=web&spd=" +
        Math.min(9, Math.max(1, Math.round(3 * s.ttsSpeed))) +
        "&text=" +
        encodeURIComponent(text),
      timeout: 15000,
      success: (response) => {
        if (response.statusCode !== 200) {
          reject(new Error("朗读服务暂不可用"));
          return;
        }
        try {
          fs.copyFileSync(response.tempFilePath, path);
          resolve(path);
        } catch {
          resolve(response.tempFilePath);
        }
      },
      fail: (error) => reject(networkError(error)),
    }),
  );
}
export async function speak(text: string): Promise<void> {
  stop();
  const ticket = generation;
  const source = text.trim();
  if (!source) return;
  if (isWord(source)) {
    try {
      await playSource(audioUrl(source), ticket, settings().ttsSpeed);
      return;
    } catch {
      if (ticket !== generation) return;
    }
  }
  // Split long selections instead of silently truncating the spoken text.
  const parts = source.match(/.{1,500}(?:\s|$)|.{1,500}/g) || [source];
  for (const part of parts) {
    if (ticket !== generation) return;
    const path = await synthesize(part);
    try {
      await playSource(path, ticket);
    } catch (error) {
      try {
        wx.getFileSystemManager().unlinkSync(path);
      } catch {
        /* 临时文件可能已移除 */
      }
      throw error;
    }
  }
}
