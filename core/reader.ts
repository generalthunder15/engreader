import { Chapter, Mark, Note, Token } from "./models";
import { joinTokens, spaceBetween } from "./text";
export interface ReaderToken extends Token {
  globalId: number;
  cid: string;
  selected: boolean;
  marked: boolean;
}
export interface Block {
  uid: string;
  cid: string;
  type: "title" | "sentence";
  text: string;
  translation: string;
  tokens: ReaderToken[];
  notes: Note[];
}
export class ReaderFlow {
  blocks: Block[] = [];
  private counter = 0;
  prepend(chapter: Chapter, marks: Mark[], notes: Note[]): void {
    if (this.blocks.some(b => b.cid === chapter.id)) return;
    const previous = new ReaderFlow();
    previous.append(chapter, marks, notes);
    this.blocks.unshift(...previous.blocks);
    this.counter = 0;
    this.tokens.forEach(token => { token.globalId = this.counter++; token.selected = false; });
  }
  append(chapter: Chapter, marks: Mark[], notes: Note[]): void {
    if (this.blocks.some((b) => b.cid === chapter.id)) return;
    this.blocks.push({
      uid: "title-" + chapter.id,
      cid: chapter.id,
      type: "title",
      text: chapter.title,
      translation: "",
      tokens: [],
      notes: [],
    });
    for (const paragraph of chapter.tokens.paragraphs) {
      const text = joinTokens(paragraph.tokens);
      this.blocks.push({
        uid: chapter.id + "-" + paragraph.pid,
        cid: chapter.id,
        type: "sentence",
        text,
        translation:
          chapter.translations[paragraph.tokens[0]?.sid ?? paragraph.pid] || "",
        notes: notes.filter(
          (n) =>
            text.toLowerCase().includes(n.sel.toLowerCase()) ||
            n.sel.toLowerCase().includes(text.toLowerCase()),
        ),
        tokens: paragraph.tokens.map((t, i) => ({
          ...t,
          globalId: this.counter++,
          cid: chapter.id,
          sp: spaceBetween(t.w, paragraph.tokens[i + 1]?.w || ""),
          selected: false,
          marked: marks.some((m) => t.id >= m.start && t.id <= m.end),
        })),
      });
    }
  }
  get tokens(): ReaderToken[] {
    return this.blocks.flatMap((b) => b.tokens);
  }
  select(start: number, end: number): ReaderToken[] {
    const lo = Math.min(start, end),
      hi = Math.max(start, end);
    for (const block of this.blocks)
      block.tokens.forEach((t) => {
        t.selected = t.globalId >= lo && t.globalId <= hi;
      });
    return this.tokens.filter((t) => t.selected);
  }
  clear(): void {
    this.blocks.forEach((b) =>
      b.tokens.forEach((t) => {
        t.selected = false;
      }),
    );
  }
  sentence(globalId: number): ReaderToken[] {
    const token = this.tokens.find((t) => t.globalId === globalId);
    if (!token) return [];
    return this.tokens.filter(
      (t) => t.cid === token.cid && t.sid === token.sid,
    );
  }
  ranges(): { cid: string; start: number; end: number; text: string }[] {
    const map = new Map<string, ReaderToken[]>();
    this.tokens
      .filter((t) => t.selected)
      .forEach((t) => map.set(t.cid, [...(map.get(t.cid) || []), t]));
    return [...map].map(([cid, tokens]) => ({
      cid,
      start: tokens[0].id,
      end: tokens[tokens.length - 1].id,
      text: joinTokens(tokens),
    }));
  }
}
