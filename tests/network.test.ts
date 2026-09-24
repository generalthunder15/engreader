import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installStorage } from "./helpers";
import * as storage from "../services/storage";
import { networkError, diagnose, endpoint } from "../services/network";
import { explain, translate, fillMeanings, parseJSON } from "../services/ai";
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
test("cached AI output can be read without a key and is separated by model", async () => {
  storage.saveSettings({ apiKey: "token", model: "first" });
  let requests = 0;
  respond('{"translation":"苹果"}', () => requests++);
  assert.equal((await explain("apple", true)).translation, "苹果");
  storage.saveSettings({ apiKey: "" });
  assert.equal((await explain("apple", true)).translation, "苹果");
  assert.equal(requests, 1);
  storage.saveSettings({ model: "second" });
  await assert.rejects(explain("apple", true), /API Key/);
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
