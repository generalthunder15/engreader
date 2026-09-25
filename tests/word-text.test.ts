import test from "node:test";
import assert from "node:assert/strict";

test("chat words preserve mixed text and only translate a double tap on the same word", async () => {
  let component: any;
  Object.assign(globalThis, { Component(value: unknown) { component = value; } });
  await import("../components/word-text/index");
  const events: unknown[] = [];
  const instance = {
    data: { ...component.data },
    setData(patch: object) { Object.assign(this.data, patch); },
    triggerEvent(name: string, detail: unknown) { events.push({ name, detail }); },
  };
  const text = "选词：Don't re-read.\nA. school  学校";
  component.observers.text.call(instance, text);
  assert.equal(instance.data.tokens.map((t: any) => t.text).join(""), text);
  const tap = (index: number) => component.methods.tap.call(instance, {
    currentTarget: { dataset: { index } }, changedTouches: [{ clientY: 180 }],
  });
  tap(1);
  assert.equal(events.length, 0);
  tap(3);
  assert.equal(events.length, 0);
  tap(3);
  assert.deepEqual(events, [{ name: "word", detail: { word: "re-read", y: 180, x: 100 } }]);
  instance.data.lastTap = Date.now() - 1000;
  tap(3);
  assert.equal(events.length, 1);
});
