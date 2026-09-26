import test from "node:test";
import assert from "node:assert/strict";

test("custom dialog cancels safely and resolves an action only once", async () => {
  let definition: any;
  Object.assign(globalThis, { Component(value: unknown) { definition = value; } });
  await import("../components/app-dialog/index");
  const instance: any = { data: { ...definition.data }, setData(patch: object) { Object.assign(this.data, patch); }, ...definition.methods };
  const results: any[] = [];
  instance.open({ itemList: ["编辑", "删除"] }, (r: unknown) => results.push(r));
  instance.choose({ currentTarget: { dataset: { index: 1 } } });
  instance.cancel();
  assert.equal(results.length, 1);
  assert.equal(results[0].tapIndex, 1);
  assert.equal(instance.data.visible, false);
  instance.open({ editable: true }, (r: unknown) => results.push(r));
  instance.change({ detail: { value: "  Book title  " } });
  instance.accept();
  assert.equal(results[1].content, "Book title");
  instance.open({}, (r: unknown) => results.push(r));
  definition.pageLifetimes.hide.call(instance);
  assert.equal(results[2].confirm, false);
  instance.open({}, (r: unknown) => results.push(r));
  definition.lifetimes.detached.call(instance);
  assert.equal(results[3].confirm, false);
});
