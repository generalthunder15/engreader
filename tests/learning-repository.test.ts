import { test } from "node:test";
import assert from "node:assert/strict";
import { installStorage } from "./helpers";
import { emptyLearning, newSession, canStart } from "../core/learning";
import * as repo from "../services/learning-repository";
import { read, transaction } from "../services/local-storage";
import { transition, PAPER } from "../core/learning-flow";

test("legacy migration preserves history and memory and can retry a failed split write", () => {
  const mock = installStorage();
  const state = emptyLearning();
  const s = newSession("old", "assessment");
  s.messages = Array.from({ length: 47 }, (_, i) => ({
    id: String(i),
    role: "assistant" as const,
    content: `解释 ${i}`,
  }));
  state.sessions.push(s);
  state.memory.markdown = "# 用户\n希望多练阅读";
  mock.wx.setStorageSync(repo.KEY, state);
  mock.failOnce("learning_v2_messages_old_1");
  assert.throws(() => repo.catalog(), /保存未完成/);
  assert.deepEqual(mock.values.get(repo.KEY), state);
  assert.equal(mock.values.has(repo.INDEX), false);
  assert.deepEqual(repo.load(), state);
  assert.equal(mock.values.has(repo.KEY), false);
  assert.deepEqual(repo.load(), state);
});

test("catalog and paged history never read unrelated conversations or older history pages", () => {
  const mock = installStorage();
  const s = newSession("long", "assessment");
  s.messages = Array.from({ length: 120 }, (_, i) => ({
    id: String(i),
    role: "assistant" as const,
    content: `消息 ${i}`,
    notice: i % 9 === 0,
  }));
  repo.insert(s);
  repo.insert(newSession("other", "lesson"));
  const reads: string[] = [];
  const original = mock.wx.getStorageSync;
  mock.wx.getStorageSync = (key) => {
    reads.push(key);
    return original(key);
  };
  repo.catalog();
  assert.ok(
    !reads.some(
      (key) =>
        key.startsWith("learning_v2_session_") ||
        key.startsWith("learning_v2_messages_"),
    ),
  );
  const recent = repo.recentMessages(s.id, 20);
  assert.deepEqual(
    recent.messages,
    s.messages.filter((m) => !m.notice).slice(-20),
  );
  assert.equal(recent.hasOlder, true);
  assert.ok(!reads.includes("learning_v2_messages_long_0"));
  assert.ok(!reads.includes("learning_v2_session_other"));
  assert.deepEqual(repo.recentMessages(s.id, 200), {
    messages: s.messages.filter((m) => !m.notice),
    hasOlder: false,
  });
});

test("appending persists only changed pages, rejects stale revisions and preserves revision on failure", () => {
  const mock = installStorage();
  const s = newSession("append", "assessment");
  s.messages = Array.from({ length: 40 }, (_, i) => ({
    id: String(i),
    role: "user" as const,
    content: "B",
  }));
  repo.insert(s);
  repo.insert(newSession("unrelated", "lesson"));
  const stale = repo.session(s.id);
  const writes: string[] = [];
  const original = mock.wx.setStorageSync;
  mock.wx.setStorageSync = (key, value) => {
    writes.push(key);
    original(key, value);
  };
  s.messages.push({ id: "new", role: "assistant", content: "解析" });
  mock.failOnce("learning_v2_messages_append_2");
  assert.throws(() => repo.commit(s), /保存未完成/);
  assert.equal(s.revision, stale.revision);
  assert.equal(repo.session(s.id).messages.length, 40);
  writes.length = 0;
  repo.commit(s);
  assert.equal(repo.session(s.id).messages.length, 41);
  assert.ok(!writes.includes("learning_v2_messages_append_0"));
  assert.ok(!writes.includes("learning_v2_session_unrelated"));
  assert.throws(() => repo.commit(stale), /学习记录已更新/);
  assert.throws(() => repo.commit(repo.session(s.id, false)), /未加载完整消息/);
});

test("course progress and chapter publication roll back together", () => {
  const mock = installStorage();
  const s = newSession("publish", "lesson");
  repo.insert(s);
  transition(s, "exam-generating");
  s.generationStep = 1;
  s.messages.push({
    id: "published",
    role: "assistant",
    content: "文章已生成",
  });
  mock.failOnce("chapter_ai_learning_new");
  assert.throws(
    () =>
      repo.commit(s, {
        book_index: ["new"],
        chapter_ai_learning_new: { text: "article" },
      }),
    /保存未完成/,
  );
  assert.equal(repo.session(s.id).phase, "generating");
  assert.equal(repo.session(s.id).messages.length, 0);
  assert.equal(mock.values.has("book_index"), false);
  repo.commit(s, {
    book_index: ["new"],
    chapter_ai_learning_new: { text: "article" },
  });
  assert.equal(repo.session(s.id).phase, "exam-generating");
  assert.equal(repo.session(s.id).messages.length, 1);
});

test("interrupted multi-key writes roll back before any data is read after restart", () => {
  const mock = installStorage();
  mock.wx.setStorageSync("chapter", { text: "old" });
  mock.wx.setStorageSync("storage_transaction_pending", [
    { key: "chapter", exists: true, value: { text: "old" } },
    { key: "index", exists: false, value: "" },
  ]);
  // Simulate termination after one or more writes but before the commit marker is cleared.
  mock.wx.setStorageSync("chapter", { text: "half-written" });
  mock.wx.setStorageSync("index", ["chapter"]);
  assert.deepEqual(read("chapter", null), { text: "old" });
  assert.equal(mock.values.has("index"), false);
  assert.equal(mock.values.has("storage_transaction_pending"), false);
});

test("rollback failure keeps recovery journal and blocks reads until recovery succeeds", () => {
  const mock = installStorage();
  mock.wx.setStorageSync("a", "old");
  const original = mock.wx.setStorageSync;
  let blocked = true;
  mock.wx.setStorageSync = (key, value) => {
    if (blocked && (key === "b" || (key === "a" && value === "old")))
      throw new Error("disk full");
    original(key, value);
  };
  assert.throws(() => transaction({ a: "new", b: "new" }), /恢复记录已保留/);
  assert.ok(mock.values.has("storage_transaction_pending"));
  assert.throws(() => read("a", ""), /disk full/);
  blocked = false;
  assert.equal(read("a", ""), "old");
  assert.equal(mock.values.has("b"), false);
});

test("state transitions reject skipped/reversed stages and catalog gate agrees with domain gate", () => {
  installStorage();
  const s = newSession("flow", "lesson");
  assert.throws(() => transition(s, "exam"), /不能从/);
  transition(s, "exam-generating");
  s.generationStep = PAPER.readyStep;
  transition(s, "reading");
  transition(s, "exam");
  transition(s, "grading");
  assert.throws(() => transition(s, "exam"), /不能从/);
  assert.throws(() => transition(s, "archived"), /不能从/);
  repo.insert(s);
  assert.equal(repo.canCreateLesson(), canStart(repo.load()));
});
