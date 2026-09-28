import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatStream } from "../core/chat-stream";
import { markdown } from "../core/markdown";
import { streamChat } from "../services/chat-stream";
import { installStorage } from "./helpers";
import * as store from "../services/storage";
const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const event = (text: string) => `data: ${JSON.stringify({choices:[{delta:{content:text}}]})}\r\n\r\n`;
test("SSE handles every byte boundary, Chinese, emoji, comments and DONE", () => {
  const updates: string[] = [];
  const decoder = new ChatStream(text => updates.push(text));
  const input = new Uint8Array(bytes(': ping\r\n\r\n' + event('中文🙂') + event(' **解释**') + 'data: [DONE]\r\n\r\n'));
  for (const byte of input) decoder.push(new Uint8Array([byte]).buffer);
  assert.equal(decoder.finish(), '中文🙂 **解释**');
  assert.deepEqual(updates, ['中文🙂', '中文🙂 **解释**']);
});
test("truncated streams and provider errors reject without losing partial content", () => {
  const decoder = new ChatStream(() => {});
  decoder.push(bytes(event('已收到')));
  assert.throws(() => decoder.finish(), /中断/);
  assert.equal(decoder.content, '已收到');
  assert.throws(() => decoder.push(bytes('data: {"error":{"message":"error"}}\n\n')), /服务/);
});
test("Markdown renders headings, emphasis, lists, quotes, code and tables safely", () => {
  const result = markdown('# 标题\n**重点**和*斜体*\n- 一\n- 二\n> 引用\n```js\nconst x = "<script>";\n```\n| A | B |\n| --- | --- |\n| 1 | 2 |\n<script>alert(1)</script>');
  for (const tag of ['h1', 'strong', 'em', 'ul', 'li', 'blockquote', 'pre', 'table', 'th', 'td']) assert.ok(result.includes('<' + tag), tag);
  assert.ok(!result.includes('<script>'));
  assert.ok(result.includes('&lt;script&gt;'));
  assert.ok(markdown('`**literal**`').includes('**literal**'));
  assert.ok(markdown('```\nunfinished').includes('unfinished'));
});
test("stream request publishes partial text before completion and supports cancellation", async () => {
  const mock = installStorage(); store.saveSettings({ apiKey: 'test-key' });
  let callback: (e: {data: ArrayBuffer}) => void = () => {};
  let request: any, aborted = false;
  Object.assign(mock.wx, { request(options: any) {
    request = options;
    return { onChunkReceived(fn: typeof callback) { callback = fn; }, abort() { aborted = true; options.fail({errMsg:'abort'}); } };
  }});
  const updates: string[] = [];
  const control: {cancel?: () => void} = {};
  const pending = streamChat([{role:'user', content:'问'}], t => updates.push(t), control);
  assert.equal(request.enableChunked, true);
  assert.equal(request.data.stream, true);
  callback({data: bytes(event('开始'))});
  assert.deepEqual(updates, ['开始']);
  control.cancel!();
  await assert.rejects(pending, /停止/);
  assert.equal(aborted, true);
  const complete = streamChat([{role:'user', content:'问'}], () => {});
  callback({data: bytes(event('完整') + 'data: [DONE]\n\n')});
  request.success({statusCode:200, data: bytes('')});
  assert.equal(await complete, '完整');
});
