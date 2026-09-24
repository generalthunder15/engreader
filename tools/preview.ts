/** Browser-only visual fixture renderer. Real runtime remains the WeChat mini program. */
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { DOMParser, Element, Node } from "@xmldom/xmldom";
import seed from "../data/seed";
import { ReaderFlow } from "../core/reader";
import { tokenize } from "../core/text";
import * as store from "../services/storage";
import { current, themes } from "../services/theme";
import { cover } from "../services/ui";
import * as fonts from "../services/fonts";

Object.assign(globalThis, {
  wx: { getStorageSync: () => "", env: { USER_DATA_PATH: "/user" } },
});
const books = seed.books.map((b) => ({
  ...b,
  chapterCount: b.chapters.length,
  cover: cover(b.hue),
  subtitle: "尚未开始阅读",
}));
const b = books[0],
  c = b.chapters[0];
const flow = new ReaderFlow();
flow.append(
  {
    id: c.id,
    bookId: b.id,
    title: c.title,
    rawText: c.text,
    tokens: tokenize(c.text),
    words: c.words.map((w) => ({ word: w[0], meaning: w[1] })),
    translations: c.translations,
    quizDone: false,
    translatedAt: 1,
    createdAt: 1,
  },
  [],
  [],
);
const fixtures: Record<string, Record<string, unknown>> = {
  shelf: { books, totalChapters: 60 },
  quiz: {
    phase: "running",
    title: "每天一点，离熟练更近",
    total: 30,
    remaining: 23,
    progress: 24,
    current: {
      word: "serendipity",
      options: [
        "偶然发现美好事物的运气",
        "持续而专注的努力",
        "对未来的无限憧憬",
        "一个值得纪念的时刻",
      ],
      answer: 0,
    },
    result: "",
    picked: -1,
  },
  mine: { books: 2, vocab: 36, sentences: 12, favorites: 5 },
  book: {
    book: {
      ...b,
      chapters: b.chapters.map((ch) => ({
        ...ch,
        wordCount: ch.words.length,
        translated: true,
      })),
    },
    cover: b.cover,
    finished: 3,
  },
  "chapter-edit": {
    title: c.title,
    content: c.text,
    words: c.words.slice(0, 4).map((w) => ({ word: w[0], meaning: w[1] })),
    editing: true,
    kind: "article",
  },
  reader: {
    book: b,
    chapterTitle: c.title,
    chapterId: c.id,
    blocks: flow.blocks,
    controls: false,
    hasMore: true,
    total: 30,
    index: 0,
    percent: 3,
    statusHeight: 24,
    showTrans: true,
  },
  study: {
    hasAssessment: true,
    canNew: false,
    label: "讲解与练习",
    readonly: false,
    current: {
      id: "lesson-preview",
      kind: "lesson",
      phase: "teaching",
      title: "第 1 课 · A Community Garden",
      generationStep: 0,
      messages: [
        {
          id: "m1",
          role: "assistant",
          content:
            "这篇文章讲述了社区花园如何让邻里走得更近。我们先看一句话：People who work together often become friends.",
        },
      ],
      pending: {
        id: "q1",
        type: "choice",
        title: "句中的 who work together 修饰哪个词？",
        options: ["People", "often", "become", "friends"],
      },
    },
    sessions: [
      {
        id: "lesson-preview",
        title: "第 1 课 · A Community Garden",
        label: "讲解与练习",
      },
      { id: "assessment", title: "初始水平测评", label: "已归档 · 只读" },
    ],
  },
  exam: {
    title: "第 1 课 · 综合试卷",
    total: 2,
    answered: 1,
    submitted: false,
    answers: { q1: "B" },
    grades: {},
    sections: [
      {
        id: "reading",
        title: "阅读理解",
        material:
          "A small community garden has changed the way people spend their weekends. Neighbors who rarely spoke now share seeds, stories, and fresh vegetables.",
        questions: [
          {
            id: "q1",
            type: "choice",
            title: "What is the main benefit of the garden?",
            options: [
              "It provides more parking spaces.",
              "It brings neighbors closer together.",
              "It replaces all local supermarkets.",
              "It makes weekends shorter.",
            ],
          },
        ],
      },
      {
        id: "translation",
        title: "英汉互译",
        material: "",
        questions: [
          {
            id: "q2",
            type: "translation",
            title: "英译汉：Small changes can make a lasting difference.",
          },
        ],
      },
    ],
  },
  memory: {
    profile: "准备考研，希望提升长难句理解能力。",
    memory: {
      mastered: [{ point: "一般现在时" }],
      weak: ["定语从句"],
      articles: [
        {
          sessionId: "a1",
          title: "A Community Garden",
          summary: "社区花园如何拉近邻里关系。",
        },
      ],
    },
  },
  settings: {
    form: store.defaults,
    themes,
    fonts: fonts.list(),
    sizes: [30, 34, 38, 42],
    lines: [1.8, 2.1, 2.4],
  },
  vocab: {
    total: 2,
    items: [
      {
        word: "serendipity",
        translation: "n. 意外发现美好事物的运气",
        phonetic: "/ˌserənˈdɪpəti/",
        fromBook: "四级英语分级阅读",
      },
      { word: "perseverance", translation: "n. 毅力，坚持不懈" },
    ],
  },
  sentences: {
    items: [
      {
        id: "1",
        text: "Small steps, taken consistently, lead to remarkable changes.",
        translation: "持续迈出小步，终会带来显著的改变。",
        bookTitle: "四级英语分级阅读",
        chapterTitle: c.title,
      },
    ],
  },
  favorites: { items: [{ id: "1", title: c.title, bookTitle: b.title }] },
};
const escape = (v: unknown): string =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
function evaluate(
  expression: string,
  context: Record<string, unknown>,
): unknown {
  try {
    return runInNewContext(expression.replace(/^{{|}}$/g, ""), context, {
      timeout: 100,
    });
  } catch {
    return "";
  }
}
const interpolate = (value: string, context: Record<string, unknown>): string =>
  value.replace(/{{([\s\S]*?)}}/g, (_, expression) =>
    String(evaluate(expression, context) ?? ""),
  );
function children(node: Node, context: Record<string, unknown>): string {
  let result = "",
    matched = false;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) {
      const element = child as Element;
      if (element.hasAttribute("wx:if")) {
        matched = !!evaluate(element.getAttribute("wx:if") || "", context);
        if (!matched) continue;
      } else if (element.hasAttribute("wx:elif")) {
        if (matched) continue;
        matched = !!evaluate(element.getAttribute("wx:elif") || "", context);
        if (!matched) continue;
      } else if (element.hasAttribute("wx:else")) {
        if (matched) continue;
        matched = true;
      } else matched = false;
    }
    result += render(child, context);
  }
  return result;
}
function render(
  node: Node,
  context: Record<string, unknown>,
  loop = true,
): string {
  if (node.nodeType === 3)
    return escape(interpolate(node.nodeValue || "", context));
  if (node.nodeType !== 1) return "";
  const element = node as Element;
  if (loop && element.hasAttribute("wx:for")) {
    const list = evaluate(element.getAttribute("wx:for") || "", context);
    return Array.isArray(list)
      ? list
          .map((item, index) =>
            render(
              element,
              {
                ...context,
                [element.getAttribute("wx:for-item") || "item"]: item,
                [element.getAttribute("wx:for-index") || "index"]: index,
              },
              false,
            ),
          )
          .join("")
      : "";
  }
  const tag = element.tagName;
  const attrs: Record<string, string> = {};
  for (let i = 0; i < element.attributes.length; i++) {
    const attribute = element.attributes.item(i)!;
    if (
      [
        "class",
        "style",
        "id",
        "placeholder",
        "value",
        "src",
        "aria-label",
      ].includes(attribute.name)
    )
      attrs[attribute.name] = interpolate(attribute.value, context);
  }
  if (tag === "app-icon")
    return `<img class="icon" src="/assets/icons/${escape(interpolate(element.getAttribute("name") || "book", context))}.svg" style="width:${Number(interpolate(element.getAttribute("size") || "40", context)) / 2}px;height:${Number(interpolate(element.getAttribute("size") || "40", context)) / 2}px">`;
  if (tag === "block") return children(element, context);
  if (tag === "slider")
    return '<input type="range" style="width:100%;accent-color:#416c64;margin:18px 0">';
  if (tag === "switch")
    return '<input type="checkbox" style="accent-color:#416c64">';
  const htmlTag =
    (
      {
        view: "div",
        text: "span",
        image: "img",
        "scroll-view": "div",
      } as Record<string, string>
    )[tag] || tag;
  if (tag === "button") attrs.type = "button";
  if (tag === "scroll-view")
    attrs.style = (attrs.style || "") + ";overflow:auto";
  const attributeText = Object.entries(attrs)
    .map(
      ([k, v]) =>
        ` ${k}="${escape(k === "style" ? v.replace(/(-?[\d.]+)rpx/g, (_, n) => Number(n) / 2 + "px") : v)}"`,
    )
    .join("");
  if (["input", "img", "br"].includes(htmlTag))
    return `<${htmlTag}${attributeText}>`;
  return `<${htmlTag}${attributeText}>${tag === "textarea" ? escape(attrs.value || "") : children(element, context)}</${htmlTag}>`;
}
function template(path: string, state: Record<string, unknown>): string {
  const xml = readFileSync(path, "utf8").replace(
    /{{[\s\S]*?}}/g,
    (expression) => expression.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
  );
  const root = new DOMParser().parseFromString(
    '<root xmlns:wx="urn:wechat">' + xml + "</root>",
    "text/xml",
  );
  return children(root.documentElement!, state);
}
function css(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/@import[^;]+;/g, "")
    .replace(/(-?[\d.]+)rpx/g, (_, n) => Number(n) / 2 + "px")
    .replace(/(?<![.\w-])page\b/g, "body")
    .replace(/(?<![.\w-])view\b/g, "div")
    .replace(/(?<![.\w-])text(?=[,{])/g, "span");
}
createServer((request, response) => {
  const url = new URL(request.url || "/", "http://localhost");
  if (url.pathname.startsWith("/assets/")) {
    const path = resolve("." + url.pathname);
    if (path.startsWith(resolve("assets") + "\\") && existsSync(path)) {
      response.writeHead(200, { "Content-Type": "image/svg+xml" });
      response.end(readFileSync(path));
      return;
    }
    response.writeHead(404);
    response.end();
    return;
  }
  const name = url.pathname.slice(1) || "shelf";
  if (!fixtures[name]) {
    response.writeHead(404);
    response.end("Unknown page");
    return;
  }
  const t = current();
  const source =
    name === "exam" ? "components/exam/index" : "pages/" + name + "/" + name;
  const state = {
    themeStyle: t.style,
    themePrimary: t.primary,
    ...fixtures[name],
  };
  const tabs = ["quiz", "shelf", "study", "mine"];
  const bar = tabs.includes(name)
    ? template("custom-tab-bar/index.wxml", {
        themeStyle: t.style,
        selected: tabs.indexOf(name),
        tabs: tabs.map((path, i) => ({
          path,
          title: ["闯关", "书架", "学习", "我的"][i],
          icon: ["spark", "book", "chat", "user"][i],
        })),
      })
    : "";
  response.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
  response.end(
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>英语精读 · ${name} 外观预览</title><style>body{margin:0}button{font-family:inherit;border:0;cursor:pointer}input,textarea{font-family:inherit}img{vertical-align:middle}.icon{display:inline-block;flex-shrink:0}button:disabled{opacity:.5}${css("app.wxss")}${css(source + ".wxss")}${css("custom-tab-bar/index.wxss")}</style></head><body style="${escape(t.style)};max-width:390px;margin:0 auto">${template(source + ".wxml", state)}${bar}</body></html>`,
  );
}).listen(4173, "127.0.0.1", () =>
  console.log(
    "Visual fixtures: http://127.0.0.1:4173/shelf (not a mini-program runtime)",
  ),
);
