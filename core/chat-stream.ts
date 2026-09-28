/** Incremental UTF-8 + SSE decoder, including split multibyte characters/events. */
export class ChatStream {
  private bytes: number[] = [];
  private pending = "";
  content = "";
  done = false;
  constructor(private update: (content: string) => void) {}
  push(chunk: ArrayBuffer) {
    for (const byte of new Uint8Array(chunk)) this.bytes.push(byte);
    let text = "", i = 0;
    while (i < this.bytes.length) {
      const first = this.bytes[i];
      const n = first < 128 ? 1 : first < 224 ? 2 : first < 240 ? 3 : 4;
      if (i + n > this.bytes.length) break;
      let code = first & (n === 1 ? 127 : n === 2 ? 31 : n === 3 ? 15 : 7);
      for (let j = 1; j < n; j++) code = (code << 6) | (this.bytes[i + j] & 63);
      text += String.fromCodePoint(code); i += n;
    }
    this.bytes = this.bytes.slice(i);
    this.pending += text;
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.pending))) {
      const event = this.pending.slice(0, match.index);
      this.pending = this.pending.slice(match.index + match[0].length);
      this.event(event);
    }
  }
  private event(event: string) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
    if (!data || this.done) return;
    if (data.trim() === "[DONE]") { this.done = true; return; }
    const payload = JSON.parse(data);
    if (payload.error) throw new Error("AI 服务返回错误，请重试");
    const choice = payload.choices?.[0];
    if (typeof choice?.delta?.content === "string") {
      this.content += choice.delta.content;
      this.update(this.content);
    }
    if (choice?.finish_reason === "length") throw new Error("回复达到长度上限，已保留收到的内容，请重试");
  }
  finish() {
    if (this.pending.trim()) this.event(this.pending);
    if (!this.done || this.bytes.length) throw new Error("回复中断，已保留收到的内容，请重试");
    if (!this.content.trim()) throw new Error("模型未返回有效内容");
    return this.content;
  }
}
