import { Word } from "./models";
export function shuffle<T>(input: T[], random = Math.random): T[] {
  const list = [...input];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}
export class Quiz {
  readonly words: Word[];
  private queue: number[];
  private missed = new Set<number>();
  current = -1;
  right = 0;
  wrong = 0;
  passed = 0;
  constructor(
    words: Word[],
    private random = Math.random,
  ) {
    const seen = new Set<string>();
    this.words = words.filter((w) => {
      const key = w.word.trim().toLowerCase();
      if (!key || !w.meaning.trim() || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    this.queue = this.words.map((_, i) => i);
  }
  next(): {
    word: string;
    meaning: string;
    options: string[];
    answer: number;
  } | null {
    this.current = this.queue.shift() ?? -1;
    if (this.current < 0) return null;
    const value = this.words[this.current];
    const pool = [
      ...new Set(
        this.words
          .filter((w) => w.meaning !== value.meaning)
          .map((w) => w.meaning),
      ),
    ];
    const options = shuffle(
      [...shuffle(pool, this.random).slice(0, 3), value.meaning],
      this.random,
    );
    return { ...value, options, answer: options.indexOf(value.meaning) };
  }
  answer(correct: boolean): void {
    if (this.current < 0) return;
    if (correct) {
      this.right++;
      if (!this.missed.has(this.current)) this.passed++;
    } else {
      this.wrong++;
      this.missed.add(this.current);
      this.queue.push(this.current);
    }
    this.current = -1;
  }
  get remaining(): number {
    return this.queue.length + (this.current < 0 ? 0 : 1);
  }
}
