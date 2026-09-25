import { hash, record } from "../core/models";
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
    hash(JSON.stringify(["bailian-qwen3-tts-flash-cherry", text, speed, premium])) +
    (premium ? ".wav" : ".mp3")
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
      const result = await request<unknown>(
        "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
        {
          method: "POST",
          key: s.ttsApiKey,
          timeout: 120000,
          data: {
            model: "qwen3-tts-flash",
            input: { text, voice: "Cherry", language_type: "English" },
          },
        },
      );
      const audio = record(record(result).output).audio;
      const url = record(audio).url;
      if (typeof url !== "string" || !/^https?:\/\/dashscope-result-bj\.oss-cn-beijing\.aliyuncs\.com\//.test(url))
        throw new Error("朗读服务未返回有效音频地址");
      const tempPath = await new Promise<string>((resolve, reject) => {
        wx.downloadFile({
          url: url.replace(/^http:/, "https:"),
          timeout: 30000,
          success: (response) => response.statusCode === 200
            ? resolve(response.tempFilePath)
            : reject(new Error("音频下载失败")),
          fail: (error) => reject(networkError(error)),
        });
      });
      fs.copyFileSync(tempPath, path);
      return path;
    } catch {
      /* 合成不可用时尝试免费音源 */
    }
  }
  const fallbackPath = cachePath(text, s.ttsSpeed, false);
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
          fs.copyFileSync(response.tempFilePath, fallbackPath);
          resolve(fallbackPath);
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
      await playSource(path, ticket, path.endsWith(".wav") ? settings().ttsSpeed : 1);
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
