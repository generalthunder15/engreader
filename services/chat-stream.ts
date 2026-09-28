import { Message } from "../core/models";
import { ChatStream } from "../core/chat-stream";
import { settings } from "./storage";
import { endpoint, networkError } from "./network";
export interface StreamControl { cancel?: () => void }
export function streamChat(messages: Message[], update: (text: string) => void, control: StreamControl = {}): Promise<string> {
  const s = settings();
  if (!s.apiKey.trim()) return Promise.reject(new Error("请先在系统设置中填写模型 API Key"));
  return new Promise((resolve, reject) => {
    let settled = false, received = false;
    const decoder = new ChatStream(update);
    const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } };
    const task = wx.request({
      url: endpoint(s.baseUrl), method: "POST", enableChunked: true, responseType: "arraybuffer", timeout: 120000,
      header: { "Content-Type": "application/json", Authorization: "Bearer " + s.apiKey },
      data: { model: s.model, messages, stream: true, temperature: .3, max_tokens: 8192, enable_thinking: false },
      success(response) {
        if (settled) return;
        if (response.statusCode < 200 || response.statusCode >= 300) { fail(new Error("AI 服务返回 HTTP " + response.statusCode)); return; }
        try {
          if (!received && response.data instanceof ArrayBuffer) decoder.push(response.data);
          const text = decoder.finish(); settled = true; resolve(text);
        } catch (error) { fail(error instanceof Error ? error : new Error("回复解析失败，请重试")); }
      },
      fail(error) { fail(networkError(error)); },
    });
    control.cancel = () => { fail(new Error("已停止回复")); task.abort(); };
    task.onChunkReceived(event => {
      if (settled) return;
      received = true;
      try { decoder.push(event.data); }
      catch (error) { fail(error instanceof Error ? error : new Error("回复解析失败，请重试")); task.abort(); }
    });
  });
}
