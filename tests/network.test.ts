import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installStorage } from "./helpers";
import * as storage from "../services/storage";
import { networkError, diagnose, endpoint } from "../services/network";
import { explain, translate, fillMeanings, parseJSON, chat } from "../services/ai";
import { cachePath, speak, stop } from "../services/audio";
let mock: ReturnType<typeof installStorage>;
beforeEach(() => {
  mock = installStorage();
});
function respond(
  content: string,
  inspect?: (options: Record<string, unknown>) => void,
) {
  Object.assign(mock.wx, {
    request(options: { success: (r: unknown) => void }) {
      inspect?.(options as unknown as Record<string, unknown>);
      options.success({
        statusCode: 200,
        data: { choices: [{ message: { content } }] },
      });
    },
  });
}
test("network distinguishes domain failure, timeout, connectivity and optional services", async () => {
  assert.equal(
    networkError({ errMsg: "request:fail timeout" }).kind,
    "timeout",
  );
  assert.equal(
    networkError({ errMsg: "url not in domain list" }).kind,
    "domain",
  );
  Object.assign(mock.wx, {
    request(o: { fail: (r: unknown) => void }) {
      o.fail({ errMsg: "timeout" });
    },
  });
  const result = await diagnose();
  assert.equal(result.at(-1)?.optional, true);
  assert.match(result[0].detail, /超时/);
  assert.doesNotMatch(result[0].detail, /域名/);
});
test("URL assembly respects custom paths without adding an extra version prefix", () => {
  assert.equal(
    endpoint("https://example.com/v1/"),
    "https://example.com/v1/chat/completions",
  );
  assert.equal(
    endpoint("https://example.com/chat/completions"),
    "https://example.com/chat/completions",
  );
});
test("cached AI output survives ignored user model overrides", async () => {
  storage.saveSettings({ apiKey: "token", model: "first" });
  let requests = 0;
  respond('{"translation":"苹果"}', () => requests++);
  assert.equal((await explain("apple", true)).translation, "苹果");
  storage.saveSettings({ apiKey: "" });
  assert.equal((await explain("apple", true)).translation, "苹果");
  assert.equal(requests, 1);
  storage.saveSettings({ model: "second" });
  assert.equal((await explain("apple", true)).translation, "苹果");
  assert.equal(requests, 1);
  await assert.rejects(explain("uncached", true), /API Key/);
});
test("missing meanings are returned in the field consumed by quiz", async () => {
  storage.saveSettings({ apiKey: "token" });
  respond('{"meanings":[{"word":"apple","meaning":"苹果"}]}');
  const result = await fillMeanings([{ word: "apple", meaning: "" }]);
  assert.equal(result[0].meaning, "苹果");
});
test("translation mismatch fails rather than saving shifted results", async () => {
  storage.saveSettings({ apiKey: "token" });
  respond('{"translations":["只有一句"]}');
  await assert.rejects(translate(["One.", "Two."]), /数量不匹配/);
  assert.deepEqual(parseJSON('```json\n{"a":1}\n```'), { a: 1 });
  assert.throws(() => parseJSON('{"incomplete":'), /不完整/);
});
test("speech cache varies with speed and premium provider", () => {
  assert.notEqual(cachePath("hello", 1, false), cachePath("hello", 1.5, false));
  assert.notEqual(cachePath("hello", 1, false), cachePath("hello", 1, true));
});
test("stopping speech settles previous playback and destroys audio listeners", async () => {
  let destroyed = 0;
  Object.assign(mock.wx, {
    createInnerAudioContext() {
      return {
        obeyMuteSwitch: false,
        src: "",
        onEnded() {},
        onError() {},
        play() {},
        stop() {},
        destroy() {
          destroyed++;
        },
      };
    },
  });
  const first = speak("hello");
  stop();
  await first;
  assert.equal(destroyed, 1);
  const second = speak("world");
  stop();
  await second;
  assert.equal(destroyed, 2);
});

test("Bailian chat uses built-in model IDs and current draft key", async () => {
  storage.saveSettings({ apiKey: "saved-key" });
  const calls: Record<string, unknown>[] = [];
  respond("OK", (options) => calls.push(options));
  await chat([{ role: "user", content: "Reply OK" }], false, false, "draft-key");
  assert.equal(calls[0].url, "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
  assert.equal((calls[0].header as Record<string, string>).Authorization, "Bearer draft-key");
  assert.equal((calls[0].data as Record<string, unknown>).model, "deepseek-v4-flash");
  assert.equal((calls[0].data as Record<string, unknown>).enable_thinking, false);
  await chat([{ role: "user", content: "Return JSON" }], true);
  assert.equal((calls[1].data as Record<string, unknown>).model, "qwen-flash");
  assert.equal(storage.settings().apiKey, "saved-key");
});
test("Bailian speech downloads WAV without forwarding API key and applies playback speed", async () => {
  storage.saveSettings({ apiKey: "bailian-key", ttsSpeed: 1.5 });
  let ended = () => {};
  let copied = "";
  const player = { playbackRate: 1, src: "", obeyMuteSwitch: false,
    onEnded(callback: () => void) { ended = callback; }, onError() {},
    play() { ended(); }, stop() {}, destroy() {} };
  Object.assign(mock.wx, {
    getFileSystemManager: () => ({ accessSync() { throw new Error("missing"); },
      copyFileSync(_source: string, destination: string) { copied = destination; } }),
    createInnerAudioContext: () => player,
    request(options: any) {
      assert.match(options.url, /dashscope\.aliyuncs\.com/);
      assert.equal(options.data.model, "qwen3-tts-flash");
      options.success({ statusCode: 200, data: { output: { audio: {
        url: "http://dashscope-result-bj.oss-cn-beijing.aliyuncs.com/test.wav?Signature=example"
      } } } });
    },
    downloadFile(options: any) {
      assert.match(options.url, /^https:\/\/dashscope-result-bj/);
      assert.equal(options.header, undefined);
      options.success({ statusCode: 200, tempFilePath: "/tmp/audio.wav" });
    },
  });
  await speak("This is a full sentence.");
  assert.match(copied, /\.wav$/);
  assert.equal(player.playbackRate, 1.5);
});
