import { PAPER, transition } from "../core/learning-flow";
import * as store from "./storage";
import { session, commit } from "./learning-repository";
import {
  learningPrompts as prompts,
  paperQuestionPrompt,
} from "./learning-prompts";
import { visibleQuestion } from "../core/learning-memory";
import { AI_BOOK, Session, required, parseExercise } from "../core/learning";
import { Chapter, record, strings } from "../core/models";
import { tokenize } from "../core/text";
import { exclusive, askJSON, context, add } from "./learning-runtime";
function publishChapter(s: Session, chapter: Chapter): void {
  const books = store.books(),
    owner = books.find((b) => b.id === AI_BOOK);
  if (!owner) throw new Error("AI 学习书籍不存在");
  const meta = {
    id: chapter.id,
    title: chapter.title,
    kind: chapter.kind,
    questionCount:
      chapter.sections?.reduce((n, v) => n + v.questions.length, 0) || 0,
    wordCount: chapter.words.length,
    translated: false,
    quizDone: chapter.quizDone,
    createdAt: chapter.createdAt,
  };
  const i = owner.chapters.findIndex((c) => c.id === chapter.id);
  if (i < 0) owner.chapters.push(meta);
  else owner.chapters[i] = meta;
  owner.chapterCount = owner.chapters.length;
  commit(s, {
    book_index: books,
    [store.chapterKey(AI_BOOK, chapter.id)]: chapter,
  });
}
function chapter(
  s: Session,
  kind: "article" | "exam",
  title: string,
  text: string,
): Chapter {
  return {
    id: kind === "article" ? s.articleId : s.examId,
    bookId: AI_BOOK,
    kind,
    sessionId: s.id,
    title,
    rawText: text,
    tokens: tokenize(text),
    words: [],
    translations: [],
    translatedAt: 0,
    quizDone: false,
    createdAt: Date.now(),
  };
}
export function generationLabel(s: Session): string {
  if (s.phase === "generating") return "生成文章与本课词表";
  const n = s.generationStep;
  return n === 0
    ? "准备本课阅读材料"
    : n <= PAPER.readingQuestions
      ? `生成阅读题 ${n}/5`
      : n === PAPER.clozeMaterialStep
        ? "生成完型材料"
        : n < PAPER.translationStartStep
          ? `生成完型题 ${n - PAPER.clozeMaterialStep}/10`
          : `生成翻译题 ${n - (PAPER.translationStartStep - 1)}/4`;
}
export async function generateStep(sid: string): Promise<void> {
  return exclusive(sid, async () => {
    const s = session(sid);
    if (s.phase === "generating") {
      const r = await askJSON(prompts.article, context(s));
      const text = required(r.text, "文章"),
        title = required(r.title, "标题");
      const words = (Array.isArray(r.words) ? r.words : [])
        .map(record)
        .map((w) => ({
          word: required(w.word, "词汇"),
          meaning: required(w.meaning, "释义"),
        }));
      if (
        words.length < 4 ||
        new Set(words.map((w) => w.word.toLowerCase())).size !== words.length
      )
        throw new Error("词表不足或重复，请重试");
      s.summary = required(r.summary, "文章概述");
      s.targets = strings(r.targets);
      if (!s.targets.length) throw new Error("缺少学习目标，请重试");
      s.title = `第 ${s.number} 课${s.review ? " · 复习" : ""} · ${title}`;
      transition(s, "exam-generating");
      s.sections = [{ id: "reading", title, material: text, questions: [] }];
      s.generationStep = 1;
      add(
        s,
        "assistant",
        "文章已生成，可以前往阅读。正在分步准备配套题目，完成单词闯关后解锁。",
      );
      s.messages[s.messages.length - 1].articleId = s.articleId;
      publishChapter(s, { ...chapter(s, "article", s.title, text), words });
      return;
    }
    if (s.phase !== "exam-generating") throw new Error("当前阶段不能生成试卷");
    const n = s.generationStep;
    if (n === 0) {
      const article = store.chapter(AI_BOOK, s.articleId);
      if (!article) throw new Error("学习文章不存在");
      s.sections = [
        {
          id: "reading",
          title: article.title,
          material: article.rawText,
          questions: [],
        },
      ];
      s.generationStep = 1;
      commit(s);
      return;
    }
    if (n === PAPER.clozeMaterialStep) {
      const r = await askJSON(prompts.cloze, {
        context: context(s),
        existing: s.sections.map((section) => ({
          ...section,
          questions: section.questions.map(visibleQuestion),
        })),
      });
      const material = required(r.material, "材料");
      if (
        Array.from(
          { length: PAPER.clozeQuestions },
          (_, i) => `[${i + 1}]`,
        ).some((token) => material.split(token).length !== 2)
      )
        throw new Error("完型材料空位编号不完整，请重试");
      s.sections.push({
        id: "cloze",
        title: required(r.title, "材料标题"),
        material,
        questions: [],
      });
    } else {
      const translation = n >= PAPER.translationStartStep,
        sectionId = translation
          ? "translation"
          : n <= PAPER.readingQuestions
            ? "reading"
            : "cloze";
      let section = s.sections.find((v) => v.id === sectionId);
      if (!section && translation) {
        section = {
          id: "translation",
          title: "英汉互译",
          material: "",
          questions: [],
        };
        s.sections.push(section);
      }
      if (!section) throw new Error("缺少前置材料");
      const index = section.questions.length + 1;
      const direction = index <= 2 ? "en-zh" : "zh-en";
      const r = await askJSON(paperQuestionPrompt(sectionId, index), {
        context: context(s),
        section: {
          ...section,
          questions: section.questions.map(visibleQuestion),
        },
      });
      const q = parseExercise(r, `${sid}_${sectionId}_${index}`);
      if (
        translation
          ? q.type !== "translation" || q.direction !== direction
          : q.type !== "choice"
      )
        throw new Error("生成题型与当前部分不符，请重试");
      section.questions.push(q);
    }
    s.generationStep++;
    if (s.generationStep === PAPER.readyStep) {
      transition(s, "reading");
      if (store.chapter(AI_BOOK, s.articleId)?.quizDone) publishExam(s);
      else {
        add(
          s,
          "assistant",
          "文章和配套题目已准备好。先阅读并完成单词闯关，之后即可查看题目。",
          undefined,
          true,
        );
        commit(s);
      }
    } else commit(s);
  });
}
function publishExam(s: Session): void {
  if (
    s.generationStep !== PAPER.readyStep ||
    s.sections.flatMap((v) => v.questions).length !== PAPER.totalQuestions
  )
    throw new Error("配套题目尚未生成完成");
  if (!store.chapter(AI_BOOK, s.articleId)?.quizDone)
    throw new Error("请先完成本章单词闯关");
  transition(s, "exam");
  s.pending = null;
  add(
    s,
    "assistant",
    "单词闯关已完成，配套题目已解锁。请前往阅读页作答并提交，之后针对错题补学。",
    undefined,
    true,
  );
  publishChapter(s, {
    ...chapter(
      s,
      "exam",
      `第 ${s.number} 课 · 配套试卷`,
      "阅读理解 · 完型填空 · 英汉互译",
    ),
    sections: s.sections,
  });
}
export function unlockExam(sid: string): void {
  const s = session(sid);
  if (s.phase !== "reading") return;
  publishExam(s);
}
