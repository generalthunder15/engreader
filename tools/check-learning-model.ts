/** Opt-in live smoke test. Key stays in the process environment; all learning data is synthetic. */
import assert from "node:assert/strict";
import {
  learningPrompts as prompts,
  questionSchema,
  paperQuestionPrompt,
} from "../services/learning-prompts";
import { parseExercise } from "../core/learning";
import { parseJSON } from "../services/ai";

async function main() {
  const key = process.env.BAILIAN_API_KEY;
  if (!key) throw new Error("Set BAILIAN_API_KEY for this process only");
  let requests = 0;
  async function call(prompt: string, data: unknown, json = true) {
    const response = await fetch(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        signal: AbortSignal.timeout(120000),
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "deepseek-v4-flash",
          temperature: 0.3,
          max_tokens: 8192,
          enable_thinking: false,
          ...(json ? { response_format: { type: "json_object" } } : {}),
          messages: [
            { role: "system", content: prompt },
            { role: "user", content: JSON.stringify(data) },
          ],
        }),
      },
    );
    requests++;
    if (!response.ok)
      throw new Error(
        `Bailian returned HTTP ${response.status}; response body withheld`,
      );
    const result = (await response.json()) as any;
    assert.notEqual(result.choices?.[0]?.finish_reason, "length");
    const text = result.choices?.[0]?.message?.content;
    assert.ok(typeof text === "string" && text.trim());
    return json ? (parseJSON(text) as any) : text;
  }
  const mixed = await call(prompts.classify, {
    supplement:
      "我选B，为什么这里不能用go？后面的题简单一点，多考一般过去时。今天外面下雨了。",
  });
  assert.ok(mixed.question && mixed.request);
  assert.match(mixed.request, /过去/);
  assert.doesNotMatch(JSON.stringify(mixed), /下雨/);
  console.log("PASS mixed supplement", JSON.stringify(mixed));
  const irrelevant = await call(prompts.classify, {
    supplement: "今天外面下雨了，窗外有只小猫。",
  });
  assert.equal(irrelevant.question, "");
  assert.equal(irrelevant.request, "");
  console.log("PASS irrelevant supplement excluded");
  const shortTerm = {
    introduction: "基础薄弱，希望达到四级，每天20分钟。",
    requirements: [mixed.request],
    rounds: [
      {
        question: {
          id: "old",
          title: "He ____ to school every day.",
          options: ["go", "goes", "going", "gone"],
        },
        answer: "B",
        correct: true,
        supplement: mixed,
      },
    ],
    earlierQuestions: [],
  };
  const context = {
    memoryMarkdown: "",
    phase: "assessment",
    review: false,
    shortTerm,
  };
  const q = parseExercise(
    await call(
      prompts.system + prompts.next + prompts.quality + questionSchema,
      { context },
    ),
    "live-q",
  );
  assert.equal(q.type, "choice");
  console.log(
    "PASS next question",
    JSON.stringify({
      title: q.title,
      material: q.material,
      options: q.options,
      answer: q.answer,
      points: q.points,
    }),
  );
  assert.match(JSON.stringify(q), /过去|yesterday|last|ago/i);
  const grade = await call(prompts.system + prompts.grade, {
    question: {
      id: "ambiguous",
      type: "choice",
      title: "Which sentence is correct?",
      options: [
        "He drink water every morning.",
        "He drinks water every morning.",
        "He drinks water every evening.",
        "He drinks milk every morning.",
      ],
    },
    reference: { answer: "B" },
    answer: "B",
    supplement: { question: "B、C、D语法都对，为什么只有B？", request: "" },
    context,
  });
  console.log("Ambiguity result", JSON.stringify(grade));
  assert.equal(grade.validQuestion, false);
  console.log("PASS ambiguous question rejected", grade.grades?.[0]?.feedback);
  const article = await call(prompts.system + prompts.article, {
    ...context,
    phase: "generating",
  });
  console.log(
    "Article structure",
    JSON.stringify({
      title: article.title,
      paragraphs: article.text.split(/\n\s*\n/).length,
    }),
  );
  assert.ok(article.text.includes("\n\n"));
  assert.ok(article.words.length >= 4);
  console.log(
    "PASS article",
    article.title,
    "words:",
    article.text.split(/\s+/).length,
  );
  const section = { id: "reading", material: article.text, questions: [] };
  const reading = parseExercise(
    await call(prompts.system + paperQuestionPrompt("reading", 1), {
      context,
      section,
    }),
    "reading",
  );
  assert.equal(reading.type, "choice");
  console.log("PASS reading question", reading.title);
  const cloze = await call(prompts.system + prompts.cloze, {
    context,
    existing: [section],
  });
  for (let n = 1; n <= 10; n++)
    assert.equal(cloze.material.split(`[${n}]`).length, 2);
  const clozeQ = parseExercise(
    await call(prompts.system + paperQuestionPrompt("cloze", 1), {
      context,
      section: { id: "cloze", material: cloze.material, questions: [] },
    }),
    "cloze",
  );
  assert.equal(clozeQ.type, "choice");
  console.log("PASS cloze material and question");
  for (const direction of ["en-zh", "zh-en"]) {
    const translation = parseExercise(
      await call(
        prompts.system +
          paperQuestionPrompt("translation", direction === "en-zh" ? 1 : 3),
        { context },
      ),
      direction,
    );
    assert.equal(translation.type, "translation");
    assert.equal(translation.direction, direction);
    console.log("PASS translation", direction, translation.title);
  }
  const archive = await call(
    prompts.archive,
    {
      previousMarkdown: "# 用户情况\n每天可用20分钟，目标四级。",
      archivedConversation:
        "用户自述基础薄弱。本次完成测评。用户明确希望后面简单一点、多考一般过去时，喜欢具体例子。没有职业信息。",
    },
    false,
  );
  assert.match(archive, /20/);
  assert.match(archive, /四级/);
  assert.match(archive, /过去/);
  assert.ok(!archive.trim().startsWith("{"));
  console.log("PASS Markdown archive\n" + archive);
  console.log(
    `Live smoke passed (${requests} requests). No user study records changed.`,
  );
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Live test failed");
  process.exitCode = 1;
});
