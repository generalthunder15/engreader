export interface Word {
  word: string;
  meaning: string;
}
export interface Token {
  id: number;
  sid: number;
  w: string;
  sp?: boolean;
}
export interface Paragraph {
  pid: number;
  tokens: Token[];
}
export interface Tokens {
  paragraphs: Paragraph[];
  sentences: string[];
  tokenCount: number;
}
export interface ChapterMeta {
  kind?: "article" | "exam";
  questionCount?: number;
  id: string;
  title: string;
  wordCount: number;
  translated: boolean;
  quizDone: boolean;
  createdAt: number;
}
export interface Book {
  id: string;
  title: string;
  author: string;
  hue: number;
  chapterCount: number;
  chapters: ChapterMeta[];
  createdAt: number;
  lastReadAt: number;
  lastChapterId: string;
}
export interface Chapter {
  kind?: "article" | "exam";
  sessionId?: string;
  sections?: import("./learning").ExamSection[];
  id: string;
  bookId: string;
  title: string;
  rawText: string;
  tokens: Tokens;
  words: Word[];
  translations: string[];
  translatedAt: number;
  quizDone: boolean;
  createdAt: number;
}
export interface Mark {
  start: number;
  end: number;
  text: string;
  createdAt: number;
}
export interface Note {
  sel: string;
  note: string;
  createdAt: number;
  start?: number;
  end?: number;
}
export interface Vocab {
  word: string;
  translation: string;
  meaning?: string;
  phonetic?: string;
  pos?: string;
  fromBook?: string;
  fromChapter?: string;
  bookId?: string;
  chapterId?: string;
  createdAt: number;
}
export interface Favorite {
  id: string;
  bookId: string;
  chapterId: string;
  title: string;
  bookTitle: string;
  createdAt: number;
}
export interface Sentence {
  id: string;
  text: string;
  translation: string;
  bookId: string;
  chapterId: string;
  bookTitle: string;
  chapterTitle: string;
  createdAt: number;
}
export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
  ts?: number;
}
export interface Settings {
  baseUrl: string;
  apiKey: string;
  model: string;
  sfBaseUrl: string;
  sfApiKey: string;
  sfModel: string;
  ttsApiKey: string;
  ttsSpeed: number;
  autoPlay: boolean;
  theme: string;
  fontRead: string;
  fontUi: string;
  readFontSize: number;
  readLineHeight: number;
  readIndent: number;
  showTrans: boolean;
  quizCount: number;
  localFallback: boolean;
}
export interface Grammar {
  structure: string;
  clauses: { text: string; type: string; explain: string }[];
  phrases: { text: string; explain: string }[];
  difficultPoints: string;
}
export interface Definition {
  translation: string;
  phonetic?: string;
  pos?: string;
  senses?: string[];
  example?: string;
  exampleTranslation?: string;
  grammar?: Grammar;
  source?: string;
}
export interface Detail {
  translation: string;
  structure: string;
  words: { word: string; meaning: string; note: string }[];
  phrases: { text: string; meaning: string; usage: string }[];
  grammar: { point: string; explain: string; example: string }[];
  summary: string;
}
export interface Seed {
  SEED_VER: number;
  WORDS_VER: number;
  books: {
    id: string;
    title: string;
    author: string;
    hue: number;
    chapters: {
      id: string;
      title: string;
      text: string;
      words: string[][];
      translations: string[];
    }[];
  }[];
}
export type UIEvent = WechatMiniprogram.CustomEvent<{
  value: string;
  [key: string]: unknown;
}>;
export function message(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试";
}
export function hash(text: string): string {
  let value = 5381;
  for (let i = 0; i < text.length; i++)
    value = ((value << 5) + value + text.charCodeAt(i)) | 0;
  return (value >>> 0).toString(36);
}
export const id = (): string =>
  "a" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}
