import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { installStorage } from "./helpers";
import * as store from "../services/storage";
import * as learning from "../services/learning";
import {
  AI_BOOK,
  canStart,
  complete,
  unresolved,
  parseGrades,
  parseExercise,
  newSession,
  Session,
  Exercise,
} from "../core/learning";
let mock: ReturnType<typeof installStorage>;
let sentMessages: any[];
let responder: (prompt: string, context: any) => unknown;
beforeEach(() => {
  mock = installStorage();
  store.saveSettings({ apiKey: "test-key" });
  responder = () => {
    throw new Error("unexpected request");
  };
  Object.assign(mock.wx, {
    request(o: any) {
      sentMessages = o.data.messages;
      const result = responder(
        o.data.messages[0].content,
        JSON.parse(o.data.messages[1].content),
      );
      if (result instanceof Error) return o.fail({ errMsg: "timeout" });
      o.success({
        statusCode: 200,
        data: { choices: [{ message: { content: JSON.stringify(result) } }] },
      });
    },
  });
});
const question = (
  title = "Choose the correct tense",
  type = "choice",
  direction = "en-zh",
) => ({
  type,
  title,
  options: ["one", "two", "three", "four"],
  answer: type === "choice" ? "A" : "a reasonable translation",
  explanation: "解释这个知识点",
  points: ["时态"],
  direction,
});
function unlock() {
  learning.initialize();
  const state = learning.load();
  const s = newSession("assessment", "assessment");
  s.phase = "archived";
  s.assessed = 24;
  state.sessions.push(s);
  store.write(learning.KEY, state);
}
function article() {
  return {
    title: "A New Garden",
    text: "A new garden gives people a place to meet. They grow vegetables together.",
    summary: "社区花园如何联结居民",
    targets: ["时态"],
    words: ["garden", "vegetable", "community", "resident"].map((word) => ({
      word,
      meaning: "n. 示例释义 " + word,
    })),
  };
}
function exerciseResponder(_p: string, c: any) {
  return c.section
    ? question("Question " + c.section.id + " " + c.section.questions.length,
        c.section.id === "translation" ? "translation" : "choice",
        c.section.questions.length < 2 ? "en-zh" : "zh-en")
    : { title: "Cloze material", material: "A passage " + Array.from({ length: 10 }, (_, i) => `[${i + 1}]`).join(" ") };
}
async function preparedLesson(): Promise<string> {
  unlock();
  const sid = learning.createLesson();
  responder = () => article();
  await learning.generateStep(sid);
  responder = exerciseResponder;
  for (let n = 1; n < 21; n++) await learning.generateStep(sid);
  return sid;
}
async function generatedLesson(): Promise<string> {
  const sid = await preparedLesson();
  assert.equal(learning.session(sid).phase, "reading");
  store.completeChapter(AI_BOOK, learning.session(sid).articleId);
  learning.unlockExam(sid);
  return sid;
}
function answers(s: Session) {
  return Object.fromEntries(
    s.sections
      .flatMap((section) => section.questions)
      .map((q) => [q.id, q.type === "choice" ? "A" : "Another valid phrasing"]),
  );
}

test("AI book starts empty and retired study data is discarded idempotently", () => {
  store.write("study_state", {
    profile: "B1 learner",
    qa: { messages: [{ role: "assistant", content: '{"reply":"旧反馈"}' }] },
  });
  learning.initialize();
  learning.initialize();
  assert.equal(store.book(AI_BOOK)?.chapterCount, 0);
  assert.equal(store.books().length, 1);
  assert.equal(learning.load().sessions.length, 0);
  assert.equal(learning.load().memory.profile, "");
  assert.equal(store.read("study_state", null), null);
  assert.equal(canStart(learning.load()), false);
});

test("introduction precedes 24 questions, answers persist before the next request, assessment becomes read-only", async () => {
  const sid = learning.createAssessment();
  responder = () => question();
  await learning.beginAssessment(sid, "准备考研，语法薄弱");
  assert.equal(learning.session(sid).assessed, 0);
  assert.equal(learning.load().memory.profile, "准备考研，语法薄弱");
  for (let n = 0; n < 24; n++) {
    responder = (_p, c) => ({
      grades: [
        { id: c.question.id, correct: n % 2 === 0, feedback: "逐题反馈" },
      ],
    });
    await learning.continueConversation(sid, "A", true);
    assert.equal(learning.session(sid).assessed, n + 1);
    assert.equal(learning.session(sid).pending, null);
    if (n === 0) {
      responder = () => new Error("timeout");
      await assert.rejects(learning.continueConversation(sid));
      assert.equal(learning.session(sid).assessed, 1);
    }
    responder = () =>
      n === 23
        ? { report: "测评结束，建议巩固时态。" }
        : question("Assessment " + n);
    await learning.continueConversation(sid);
  }
  assert.equal(learning.session(sid).phase, "archived");
  assert.equal(canStart(learning.load()), true);
  await assert.rejects(learning.continueConversation(sid, "继续聊天"), /不能/);
});

test("article failure retries the same session and does not duplicate chapters or lesson number", async () => {
  unlock();
  const sid = learning.createLesson();
  responder = () => new Error("timeout");
  await assert.rejects(learning.generateStep(sid));
  assert.equal(learning.session(sid).phase, "generating");
  assert.equal(store.book(AI_BOOK)?.chapterCount, 0);
  assert.throws(() => learning.createLesson(), /完成/);
  responder = () => article();
  await learning.generateStep(sid);
  assert.equal(store.book(AI_BOOK)?.chapterCount, 1);
  assert.equal(learning.session(sid).number, 1);
  await assert.rejects(learning.generateStep(sid));
  assert.equal(store.book(AI_BOOK)?.chapterCount, 1);
  assert.equal(learning.session(sid).phase, "exam-generating");
  await assert.rejects(learning.continueConversation(sid), /不能/);
});

test("full exam generation, AI grading and targeted remediation enforce the lesson gate", async () => {
  const sid = await generatedLesson();
  let s = learning.session(sid);
  assert.deepEqual(
    s.sections.map((v) => v.questions.length),
    [5, 10, 4],
  );
  assert.equal(store.book(AI_BOOK)?.chapterCount, 2);
  learning.submitExam(sid, answers(s));
  assert.equal(learning.session(sid).phase, "grading");
  assert.throws(() => learning.createLesson(), /完成/);
  responder = (_p, c) => ({
    grades: c.sections
      .flatMap((v: any) => v.questions)
      .map((q: Exercise, i: number) => ({
        id: q.id,
        correct: i !== 0,
        feedback: i === 0 ? "时态使用不当" : "含义正确，可以接受",
      })),
  });
  await learning.gradeExam(sid);
  s = learning.session(sid);
  assert.equal(s.phase, "remediation");
  assert.deepEqual(unresolved(s), ["时态"]);
  assert.equal(complete(s), false);
  assert.equal(
    s.evidence.length,
    0,
    "pre-exam practice cannot discharge exam errors",
  );
  assert.throws(() => learning.createLesson(), /完成/);
  responder = () => question("A completely new tense exercise");
  await learning.continueConversation(sid);
  responder = (_p, c) => ({
    grades: [{ id: c.question.id, correct: false, feedback: "还需要巩固" }],
  });
  await learning.continueConversation(sid, "B", true);
  assert.equal(learning.session(sid).phase, "remediation");
  responder = () => question("Another different tense exercise");
  await learning.continueConversation(sid);
  responder = (_p, c) => ({
    grades: [{ id: c.question.id, correct: true, feedback: "这次时态正确" }],
  });
  await learning.continueConversation(sid, "A", true);
  assert.equal(learning.session(sid).phase, "complete");
  assert.equal(canStart(learning.load()), true);
  assert.equal(learning.load().memory.articles.length, 1);
  assert.ok(learning.load().memory.mastered.some((v) => v.point === "时态"));
  const backup = store.exportBackup();
  store.importBackup(backup);
  const next = learning.createLesson();
  assert.equal(learning.session(next).number, 2);
  assert.equal(learning.session(next).messages.length, 0);
  assert.equal(learning.load().memory.articles.length, 1);
});

test("all-correct exam completes immediately; missing or duplicate grades never pass", async () => {
  const sid = await generatedLesson();
  const s = learning.session(sid);
  learning.submitExam(sid, answers(s));
  responder = () => ({ grades: [] });
  await assert.rejects(learning.gradeExam(sid), /漏题/);
  assert.equal(learning.session(sid).phase, "grading");
  assert.equal(canStart(learning.load()), false);
  responder = (_p, c) => ({
    grades: c.sections
      .flatMap((v: any) => v.questions)
      .map((q: Exercise) => ({ id: q.id, correct: true, feedback: "正确" })),
  });
  await learning.gradeExam(sid);
  assert.equal(learning.session(sid).phase, "complete");
  assert.ok(learning.load().memory.mastered.length > 0);
  const qs = s.sections.flatMap((v) => v.questions);
  assert.throws(
    () =>
      parseGrades(
        {
          grades: qs.map(() => ({
            id: qs[0].id,
            correct: true,
            feedback: "正确",
          })),
        },
        qs,
      ),
    /题号/,
  );
});

test("a failed exam step preserves previous material and retries only its question", async () => {
  unlock();
  const sid = learning.createLesson();
  responder = () => article();
  await learning.generateStep(sid);
  const state = learning.load();
  state.sessions.find((v) => v.id === sid)!.phase = "exam-generating";
  store.write(learning.KEY, state);
  responder = () => new Error("timeout");
  await assert.rejects(learning.generateStep(sid));
  assert.equal(learning.session(sid).generationStep, 1);
  assert.equal(
    learning.session(sid).sections[0].material,
    article().text,
  );
  responder = () => question();
  await learning.generateStep(sid);
  assert.equal(learning.session(sid).generationStep, 2);
  assert.equal(learning.session(sid).sections.length, 1);
  assert.equal(learning.session(sid).sections[0].questions.length, 1);
});

test("restore rejects fabricated completion and missing article without changing live storage", async () => {
  const sid = await generatedLesson();
  const original = store.exportBackup();
  const corrupt = structuredClone(original);
  const learningData = corrupt.data[learning.KEY] as ReturnType<
    typeof learning.load
  >;
  learningData.sessions.find((s) => s.id === sid)!.phase = "complete";
  assert.throws(() => store.importBackup(corrupt), /通过证据/);
  assert.equal(learning.session(sid).phase, "exam");
  const missing = structuredClone(original);
  delete missing.data[
    store.chapterKey(AI_BOOK, learning.session(sid).articleId)
  ];
  assert.throws(() => store.importBackup(missing), /章节/);
  assert.deepEqual(store.exportBackup().data, original.data);
});

test("third and sixth lessons are review lessons and old backups cannot leave unrelated active sessions", () => {
  assert.equal(newSession("third", "lesson", 3).review, true);
  assert.equal(newSession("sixth", "lesson", 6).review, true);
  assert.equal(newSession("fourth", "lesson", 4).review, false);
  unlock();
  learning.createLesson();
  store.importBackup({
    version: 3,
    data: { book_index: [], study_state: { profile: "restored" } },
  });
  assert.equal(learning.load().sessions.length, 0);
  assert.equal(learning.load().memory.profile, "");
  assert.equal(store.read("study_state", null), null);
});

test("new same-type evidence is required for every wrong knowledge point", () => {
  const s = newSession("lesson", "lesson", 1);
  const first = parseExercise(question("Original"), "original");
  s.sections = [
    {
      id: "reading",
      title: "Reading",
      material: "passage",
      questions: [first],
    },
  ];
  s.attempt = {
    submittedAt: 100,
    answers: { original: "B" },
    grades: [
      {
        id: "original",
        correct: false,
        feedback: "wrong",
        points: ["时态", "语态"],
      },
    ],
  };
  const fresh = parseExercise(question("New exercise"), "new");
  s.evidence = [
    {
      point: "时态",
      question: first,
      answer: "A",
      correct: true,
      feedback: "ok",
      at: 101,
    },
  ];
  assert.deepEqual(unresolved(s), ["时态", "语态"]);
  s.evidence = [
    {
      point: "时态",
      question: fresh,
      answer: "A",
      correct: true,
      feedback: "ok",
      at: 99,
    },
  ];
  assert.deepEqual(unresolved(s), ["时态", "语态"]);
  s.evidence[0].at = 101;
  assert.deepEqual(unresolved(s), ["语态"]);
});

test("reader exam component restores drafts, freezes submitted answers and persists AI feedback", async () => {
  let definition: any;
  Object.assign(globalThis, {
    Component(value: unknown) {
      definition = value;
    },
  });
  await import("../components/exam/index");
  const book = store.createBook("My exercises");
  const q1 = parseExercise(question("A choice"), "choice");
  const q2 = parseExercise(
    question("Translate this sentence", "translation"),
    "translation",
  );
  const sections = [
    {
      id: "section",
      title: "Reading and translation",
      material: "A short passage.",
      questions: [q1, q2, parseExercise(question("Fill a blank", "fill"), "blank")],
    },
  ];
  store.saveChapter({
    id: "exam",
    bookId: book.id,
    title: "My exam",
    kind: "exam",
    sections,
    rawText: "A short passage.",
    tokens: { paragraphs: [], sentences: [], tokenCount: 0 },
    words: [],
    translations: [],
    translatedAt: 0,
    quizDone: false,
    createdAt: 1,
  });
  function mount() {
    const instance: any = {
      properties: { bookId: book.id, chapterId: "exam" },
      data: structuredClone(definition.data),
      setData(patch: object) {
        Object.assign(this.data, patch);
      },
    };
    for (const [key, value] of Object.entries(definition.methods))
      instance[key] = (value as Function).bind(instance);
    instance.refresh();
    return instance;
  }
  const first = mount();
  first.pick({ currentTarget: { dataset: { id: "choice", value: "B" } } });
  first.fill({
    currentTarget: { dataset: { id: "translation" } },
    detail: { value: "A valid alternative translation" },
  });
  const reopened = mount();
  assert.deepEqual(reopened.data.answers, {
    choice: "B",
    translation: "A valid alternative translation",
  });
  responder = () => new Error("timeout");
  await reopened.submit();
  assert.equal(reopened.data.submitted, true);
  assert.equal(reopened.data.graded, false);
  reopened.pick({ currentTarget: { dataset: { id: "choice", value: "A" } } });
  assert.equal(reopened.data.answers.choice, "B");
  reopened.fill({ currentTarget: { dataset: { id: "blank" } }, detail: { value: "late answer" } });
  assert.equal(reopened.data.answers.blank, "");
  const locked = mount();
  locked.fill({ currentTarget: { dataset: { id: "blank" } }, detail: { value: "late again" } });
  assert.equal(locked.data.answers.blank, "");
  responder = (_p, c) => ({
    grades: c.sections
      .flatMap((s: any) => s.questions)
      .map((q: Exercise) => ({
        id: q.id,
        correct: true,
        feedback: "意思准确，可以接受",
      })),
  });
  await reopened.submit();
  assert.equal(reopened.data.graded, true);
  assert.equal(reopened.data.correct, 2);
  const final = mount();
  assert.equal(final.data.graded, true);
  assert.equal(final.data.grades.blank.correct, false);
  assert.equal(final.data.grades.translation.feedback, "意思准确，可以接受");
});

test("opening a new lesson stops at reading instead of trying to skip its word challenge", async () => {
  let definition: any;
  Object.assign(globalThis, {
    Page(value: unknown) {
      definition = value;
    },
  });
  Object.assign(mock.wx, { pageScrollTo() {} });
  await import("../pages/study/study");
  unlock();
  responder = (p, c) => p.includes("全新英文文章") ? article() : exerciseResponder(p, c);
  const page: any = {
    ...definition,
    data: structuredClone(definition.data),
    setData(patch: object) {
      Object.assign(this.data, patch);
    },
  };
  for (const [key, value] of Object.entries(definition))
    if (typeof value === "function") page[key] = value.bind(page);
  await page.newLesson();
  assert.equal(page.data.current.phase, "reading");
  assert.equal(page.data.error, "");
  assert.equal(page.data.busy, false);
  assert.equal(store.book(AI_BOOK)?.chapterCount, 1);
});

test("cleanup and backup restore remove migrated legacy conversations but preserve current courses", () => {
  unlock();
  const sid = learning.createLesson();
  const state = learning.load();
  state.memory.profile = "Current learning goal";
  state.sessions.push({
    ...newSession("legacy_study", "assessment"),
    kind: "legacy",
    phase: "archived",
  } as unknown as Session);
  store.write(learning.KEY, state);
  store.write("study_state", { profile: "old" });
  learning.initialize();
  assert.equal(learning.session(sid).phase, "generating");
  assert.equal(learning.load().sessions.length, 2);
  assert.equal(learning.load().memory.profile, "Current learning goal");
  assert.equal(store.read("study_state", null), null);
  const backup = store.exportBackup();
  backup.data[learning.KEY] = state;
  backup.data.study_state = { profile: "old" };
  store.importBackup(backup);
  assert.equal(learning.load().sessions.length, 2);
  assert.equal(learning.session(sid).phase, "generating");
  assert.equal("study_state" in store.exportBackup().data, false);
});

test("questions are prepared with the article but remain inaccessible until word challenge completion", async () => {
  const sid = await preparedLesson();
  let s = learning.session(sid);
  assert.equal(s.generationStep, 21);
  assert.deepEqual(s.sections.map(v => v.questions.length), [5, 10, 4]);
  assert.equal(s.sections[0].material, article().text);
  assert.equal(s.phase, "reading");
  assert.equal(s.pending, null);
  assert.equal(store.book(AI_BOOK)?.chapterCount, 1);
  assert.equal(store.chapter(AI_BOOK, s.examId), null);
  assert.throws(() => learning.unlockExam(sid), /闯关/);
  assert.throws(() => learning.submitExam(sid, answers(s)), /尚未准备/);
  assert.ok(s.messages.some(m => m.articleId === s.articleId));
  store.importBackup(store.exportBackup());
  assert.equal(learning.session(sid).phase, "reading");
  store.completeChapter(AI_BOOK, s.articleId);
  learning.unlockExam(sid);
  s = learning.session(sid);
  assert.equal(s.phase, "exam");
  assert.equal(store.book(AI_BOOK)?.chapterCount, 2);
  assert.equal(store.chapter(AI_BOOK, s.examId)?.sections?.length, 3);
  learning.unlockExam(sid);
  assert.equal(store.book(AI_BOOK)?.chapterCount, 2);
  await assert.rejects(learning.continueConversation(sid), /不能/);
});
test("finishing word challenge while generation is in progress unlocks the paper only when complete", async () => {
  unlock();
  const sid = learning.createLesson();
  responder = () => article();
  await learning.generateStep(sid);
  store.completeChapter(AI_BOOK, learning.session(sid).articleId);
  learning.unlockExam(sid);
  assert.equal(learning.session(sid).phase, "exam-generating");
  assert.equal(store.chapter(AI_BOOK, learning.session(sid).examId), null);
  responder = exerciseResponder;
  for (let n = 1; n < 21; n++) await learning.generateStep(sid);
  assert.equal(learning.session(sid).phase, "exam");
  assert.equal(store.book(AI_BOOK)?.chapterCount, 2);
});
test("legacy teaching sessions skip conversation practice and retain history and generated material", async () => {
  const sid = await preparedLesson();
  const state = learning.load();
  const s = state.sessions.find(s => s.id === sid)!;
  s.phase = "teaching";
  s.pending = parseExercise(question(), "retired-question");
  const messages = structuredClone(s.messages);
  store.write(learning.KEY, state);
  const migrated = learning.session(sid);
  assert.equal(migrated.phase, "reading");
  assert.equal(migrated.pending, null);
  assert.deepEqual(migrated.messages, messages);
  assert.deepEqual(migrated.sections, s.sections);
  await assert.rejects(learning.continueConversation(sid), /不能/);
});

test("partial lesson submission locks all answers including blanks and requires remediation for omissions", async () => {
  const sid = await generatedLesson();
  const s = learning.session(sid);
  const qid = s.sections[0].questions[0].id;
  learning.submitExam(sid, { [qid]: "A" });
  const submitted = learning.session(sid);
  assert.equal(Object.keys(submitted.attempt!.answers).length, 19);
  assert.equal(Object.values(submitted.attempt!.answers).filter(v => v === "").length, 18);
  assert.throws(() => learning.submitExam(sid, answers(s)), /已提交/);
  store.importBackup(store.exportBackup());
  responder = (_p, c) => ({ grades: c.sections.flatMap((s: any) => s.questions).map((q: Exercise) => ({ id: q.id, correct: true, feedback: "反馈" })) });
  await learning.gradeExam(sid);
  assert.equal(learning.session(sid).attempt!.grades.filter(g => !g.correct).length, 18);
  assert.equal(learning.session(sid).phase, "remediation");
  assert.equal(canStart(learning.load()), false);
});
