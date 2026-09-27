import test from "node:test";
import assert from "node:assert/strict";
test("exam text distinguishes a single tap, double tap, long press and scrolling", async () => {
  let definition: any;
  Object.assign(globalThis, { Component(value: unknown) { definition = value; } });
  await import("../components/reading-text/index");
  const events: any[] = [];
  const instance: any = {
    properties: { selectionKey: "reading" }, data: structuredClone(definition.data),
    setData(p: object, cb?: () => void) { Object.assign(this.data, p); cb?.(); },
    triggerEvent(name: string, detail: unknown) { events.push({ name, detail }); },
    createSelectorQuery() { const query: any = { selectAll() { return query; }, boundingClientRect() { return query; }, exec(cb: Function) { cb([[{ left: 10, right: 80, top: 100, bottom: 120 }]]); } }; return query; },
    ...definition.methods,
  };
  definition.observers.text.call(instance, "Hello world. Read again!\n\nNext paragraph.");
  assert.equal(instance.data.paragraphs.length, 2);
  const e = { currentTarget: { dataset: { id: 0 } }, touches: [{ clientX: 20, clientY: 100 }] };
  instance.begin(e); instance.tap(e);
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(events[0].name, "readtap");
  events.length = 0;
  instance.begin(e); instance.tap(e); instance.begin(e); instance.tap(e);
  assert.equal(events[0].name, "selection"); assert.equal(events[0].detail.text, "Hello");
  events.length = 0;
  instance.begin(e); instance.hold(e); instance.tap(e);
  assert.equal(events[0].detail.text, "Hello world.");
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(events.length, 1);
  events.length = 0;
  instance.begin(e); instance.move({ touches: [{ clientX: 20, clientY: 160 }] }); instance.tap(e);
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(events.length, 0);
  definition.observers.activeKey.call(instance, "");
  assert.equal(instance.data.start, -1);
});
