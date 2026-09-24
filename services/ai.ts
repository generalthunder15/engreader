import {
  Definition,
  Detail,
  Grammar,
  Message,
  Plan,
  Question,
  Study,
  Word,
  record,
  strings,
} from "../core/models";
import { chunks } from "../core/text";
import * as storage from "./storage";
import { endpoint, request } from "./network";

export function parseJSON(text: string): unknown {
  const source = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(source);
  } catch {
    const begin = source.search(/[\[{]/);
    const end = Math.max(source.lastIndexOf("}"), source.lastIndexOf("]"));
    if (begin >= 0 && end > begin) {
      try {
        return JSON.parse(source.slice(begin, end + 1));
      } catch {
        /* 显式失败，不能吞掉不完整输出 */
      }
    }
    throw new Error("模型返回的内容不完整，请重试");
  }
}
export async function chat(
  messages: Message[],
  lightweight = false,
  json = true,
): Promise<string> {
  const s = storage.settings();
  const auxiliary = lightweight && !!s.sfApiKey;
  const key = auxiliary ? s.sfApiKey : s.apiKey;
  const base = auxiliary ? s.sfBaseUrl : s.baseUrl;
  const model = auxiliary ? s.sfModel : s.model;
  if (!key.trim()) throw new Error("请先在系统设置中填写模型 API Key");
  const result = await request<unknown>(endpoint(base), {
    method: "POST",
    key,
    timeout: 120000,
    data: {
      model,
      messages,
      temperature: 0.3,
      max_tokens: 8192,
      ...(json ? { response_format: { type: "json_object" } } : {}),
      ...(/^https?:\/\/api\.deepseek\.com(?:\/|$)/i.test(base)
        ? { thinking: { type: "disabled" } }
        : {}),
    },
  });
  const choices = record(result).choices;
  const first = Array.isArray(choices) ? record(choices[0]) : {};
  if (first.finish_reason === "length")
    throw new Error("模型输出超出长度限制，请缩短文本后重试");
  const content = record(first.message).content;
  if (typeof content !== "string" || !content.trim())
    throw new Error("模型未返回有效内容");
  return content;
}
const prompts = {
  word: '你是英语词典。返回 JSON：{"translation":"中文常用释义","phonetic":"音标","pos":"词性","senses":["其他义项"],"example":"英文例句","exampleTranslation":"中文例句"}。',
  sentence:
    '你是英语精读老师。返回 JSON：{"translation":"中文翻译","grammar":{"structure":"主干结构","clauses":[{"text":"原文","type":"从句类型","explain":"解释"}],"phrases":[{"text":"搭配","explain":"解释"}],"difficultPoints":"难点"}}。',
  detail:
    '你是英语精读老师。按单词、短语、语法逐层拆解，返回 JSON：{"translation":"中文翻译","structure":"结构总览","words":[{"word":"单词","meaning":"中文含义","note":"成分或词形"}],"phrases":[{"text":"短语","meaning":"含义","usage":"用法"}],"grammar":[{"point":"语法点","explain":"解释","example":"英文例句"}],"summary":"学习要点"}。',
  suggestions:
    '针对原文最值得学习的语法、词义生成三个简短的中文问题，返回 JSON：{"questions":["问题1","问题2","问题3"]}。',
  ask: "你是耐心的英语老师，用简洁中文直接回答关于原文的问题。引用原文解释，不输出 JSON。",
};
type Task = keyof typeof prompts;
const pending = new Map<string, Promise<unknown>>();
function validTaskResult(task: Task, value: unknown): boolean {
  if (task === 'ask') return typeof value === 'string' && !!value.trim();
  const result = record(value);
  if (task === 'suggestions') return strings(result.questions).length > 0;
  return typeof result.translation === 'string' && !!result.translation.trim();
}
async function cached(
  task: Task,
  text: string,
  question = "",
): Promise<unknown> {
  if (!text.trim()) throw new Error("请先选择文本");
  const s = storage.settings();
  // Use exact input as the cache identity; case and punctuation can change meaning.
  const identity = JSON.stringify([s.baseUrl, s.model, task, text, question]);
  const { hash } = await import("../core/models");
  const key = "ai2_" + hash(identity);
  const old = storage.read<{ identity: string; value: unknown } | null>(
    key,
    null,
  );
  if (old?.identity === identity && validTaskResult(task, old.value)) return old.value;
  const previous = pending.get(identity);
  if (previous) return previous;
  const promise = chat(
    [
      { role: "system", content: prompts[task] },
      { role: "user", content: text + (question ? "\n问题：" + question : "") },
    ],
    false,
    task !== "ask",
  )
    .then((result) => {
      const value: unknown = task === "ask" ? result : parseJSON(result);
      if (!validTaskResult(task, value)) throw new Error('模型返回内容不完整，请重试');
      try {
        storage.write(key, { identity, value });
      } catch {
        /* 缓存失败不丢弃有效响应 */
      }
      return value;
    })
    .finally(() => pending.delete(identity));
  pending.set(identity, promise);
  return promise;
}
export async function explain(
  text: string,
  word: boolean,
): Promise<Definition> {
  const value = record(await cached(word ? "word" : "sentence", text));
  if (typeof value.translation !== "string" || !value.translation.trim())
    throw new Error("模型未返回释义");
  const g = record(value.grammar);
  const grammar: Grammar | undefined = Object.keys(g).length
    ? {
        structure: String(g.structure || ""),
        clauses: (Array.isArray(g.clauses) ? g.clauses : []).map((v) => {
          const c = record(v);
          return {
            text: String(c.text || ""),
            type: String(c.type || ""),
            explain: String(c.explain || ""),
          };
        }),
        phrases: (Array.isArray(g.phrases) ? g.phrases : []).map((v) => {
          const p = record(v);
          return {
            text: String(p.text || ""),
            explain: String(p.explain || ""),
          };
        }),
        difficultPoints: String(g.difficultPoints || ""),
      }
    : undefined;
  return {
    translation: value.translation,
    phonetic: String(value.phonetic || ""),
    pos: String(value.pos || ""),
    senses: strings(value.senses),
    example: String(value.example || ""),
    exampleTranslation: String(value.exampleTranslation || ""),
    ...(grammar ? { grammar } : {}),
    source: "ai",
  };
}
export async function detail(text: string): Promise<Detail> {
  const r = record(await cached("detail", text));
  if (typeof r.translation !== "string") throw new Error("详细解析格式不完整");
  const rows = (v: unknown): Record<string, unknown>[] =>
    Array.isArray(v) ? v.map(record) : [];
  return {
    translation: r.translation,
    structure: String(r.structure || ""),
    summary: String(r.summary || ""),
    words: rows(r.words).map((w) => ({
      word: String(w.word || ""),
      meaning: String(w.meaning || ""),
      note: String(w.note || ""),
    })),
    phrases: rows(r.phrases).map((p) => ({
      text: String(p.text || ""),
      meaning: String(p.meaning || ""),
      usage: String(p.usage || ""),
    })),
    grammar: rows(r.grammar).map((g) => ({
      point: String(g.point || ""),
      explain: String(g.explain || ""),
      example: String(g.example || ""),
    })),
  };
}
export const suggestions = async (text: string): Promise<string[]> =>
  strings(record(await cached("suggestions", text)).questions).slice(0, 3);
export const ask = async (text: string, question: string): Promise<string> =>
  String(await cached("ask", text, question));
export async function extractWords(
  text: string,
  progress: (done: number, total: number) => void = () => {},
): Promise<Word[]> {
  const parts = chunks(text);
  const words = new Map<string, Word>();
  for (let i = 0; i < parts.length; i++) {
    const result = record(
      parseJSON(
        await chat(
          [
            {
              role: "system",
              content:
                '逐句穷尽式提取 B1 及以上英语词汇，跳过 A1/A2 基础词。短语、习语和固定搭配不受难度限制。单词还原原形，短语按文中形式。按出现顺序、不限数量，给常用中文释义和词性。只返回 JSON：{"words":[{"word":"英文","meaning":"中文含义"}]}。',
            },
            { role: "user", content: parts[i] },
          ],
          true,
        ),
      ),
    );
    if (!Array.isArray(result.words))
      throw new Error("第 " + (i + 1) + " 段词表格式错误，请重试");
    for (const raw of result.words) {
      const w = record(raw);
      if (typeof w.word === "string" && w.word.trim()) {
        const key = w.word.trim().toLowerCase();
        if (!words.has(key))
          words.set(key, {
            word: w.word.trim(),
            meaning: String(w.meaning || "").trim(),
          });
      }
    }
    progress(i + 1, parts.length);
  }
  return [...words.values()];
}
export async function translate(
  sentences: string[],
  progress: (done: number, total: number) => void = () => {},
): Promise<string[]> {
  const result: string[] = [];
  for (let i = 0; i < sentences.length; i += 8) {
    const batch = sentences.slice(i, i + 8);
    const output = record(
      parseJSON(
        await chat(
          [
            {
              role: "system",
              content:
                '将每个英文句子翻译成通顺中文，不合并、不遗漏，数组长度与输入完全一致。JSON：{"translations":["翻译"]}。',
            },
            { role: "user", content: JSON.stringify(batch) },
          ],
          true,
        ),
      ),
    );
    const translated = strings(output.translations);
    if (translated.length !== batch.length || translated.some((t) => !t.trim()))
      throw new Error("句译数量不匹配，请重试，原章节尚未修改");
    result.push(...translated);
    progress(result.length, sentences.length);
  }
  return result;
}
export async function fillMeanings(words: Word[]): Promise<Word[]> {
  const missing = words.filter((w) => !w.meaning.trim());
  if (!missing.length) return words;
  const result = new Map<string, string>();
  for (let i = 0; i < missing.length; i += 30) {
    const raw = record(
      parseJSON(
        await chat(
          [
            {
              role: "system",
              content:
                '为每个英文词或短语补充含词性的中文释义。JSON：{"meanings":[{"word":"原词","meaning":"释义"}]}。',
            },
            {
              role: "user",
              content: JSON.stringify(
                missing.slice(i, i + 30).map((w) => w.word),
              ),
            },
          ],
          true,
        ),
      ),
    );
    if (Array.isArray(raw.meanings))
      for (const entry of raw.meanings) {
        const item = record(entry);
        if (typeof item.word === "string" && typeof item.meaning === "string")
          result.set(item.word.toLowerCase(), item.meaning);
      }
  }
  return words.map((w) => ({
    ...w,
    meaning: w.meaning || result.get(w.word.toLowerCase()) || "",
  }));
}
export interface StudyReply {
  reply: string;
  question: Question | null;
  memory: string;
  plan: Plan | null;
}
export function parseStudyReply(raw: unknown): StudyReply {
  const r = record(raw);
  if (typeof r.reply !== "string" || !r.reply.trim())
    throw new Error("学习教练未返回有效答复");
  const q = record(r.question);
  let question: Question | null = null;
  if (typeof q.title === "string" && q.title.trim()) {
    if (q.type === "choice") {
      const options = strings(q.options);
      if (options.length !== 4) throw new Error("测评选项不完整，请重试");
      question = { type: "choice", title: q.title, options };
    } else question = { type: "input", title: q.title };
  }
  const p = record(r.plan);
  const plan: Plan | null = Array.isArray(p.chapters)
    ? {
        text: String(p.text || ""),
        createdAt: Date.now(),
        chapters: p.chapters
          .map(record)
          .filter(
            (c) =>
              typeof c.bookId === "string" && typeof c.chapterId === "string",
          )
          .map((c) => ({
            bookId: String(c.bookId),
            chapterId: String(c.chapterId),
            title: String(c.title || ""),
            done: false,
          }))
          .filter((c) => !!storage.chapter(c.bookId, c.chapterId)),
      }
    : null;
  return {
    reply: r.reply,
    question,
    memory: typeof r.memory === "string" ? r.memory : "",
    plan: plan?.chapters.length ? plan : null,
  };
}
export async function coach(
  state: Study,
  input: string,
  answered: number,
): Promise<StudyReply> {
  const bookshelf = storage
    .books()
    .flatMap((b) =>
      b.chapters.map((c) => ({
        bookId: b.id,
        chapterId: c.id,
        title: b.title + " · " + c.title,
      })),
    );
  const final =
    state.phase === "assess" && answered >= (state.assess?.total || 24);
  const prompt =
    '你是私人英语教练。摸底共24题，逐题四选一，覆盖词汇、语法、阅读，根据回答调整难度。回答后点评再出下一题。摸底结束必须从书架选择真实章节生成计划。阅读后的 qa 阶段根据已读章节每次出一道填空或简答题并点评回答。返回严格JSON：{"reply":"中文反馈","question":{"type":"choice或input","title":"题干","options":["四个选项"]},"memory":"累计学习者画像","plan":{"text":"学习计划","chapters":[{"bookId":"真实id","chapterId":"真实id","title":"标题"}]}}。无需题目或计划时用null。\n当前阶段：' +
    (final ? "plan-end，停止出题，生成计划" : state.phase) +
    "\n已完成摸底题数：" +
    answered +
    "\n画像：" +
    state.profile +
    "\n书架：" +
    JSON.stringify(bookshelf);
  const context =
    state.phase === "qa"
      ? "\n已读章节原文：" +
        (state.plan?.chapters || [])
          .map((c) => storage.chapter(c.bookId, c.chapterId)?.rawText || "")
          .join("\n")
          .slice(0, 16000)
      : "";
  const response = parseStudyReply(
    parseJSON(
      await chat([
        { role: "system", content: prompt + context },
        ...(state.qa?.messages || [])
          .slice(-48)
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: input },
      ]),
    ),
  );
  if (final && !response.plan)
    throw new Error("未生成有效的书架阅读计划，请重试");
  if (!final && state.phase === "assess" && !response.question)
    throw new Error("未生成测评题目，请重试");
  if (!final) response.plan = null;
  return response;
}
