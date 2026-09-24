import { Definition, hash, record } from "../core/models";
import { dictionary } from "../data/dictionary";
import seed from "../data/seed";
import * as storage from "./storage";
import { request } from "./network";
let local: Map<string, string> | undefined;
export function offline(word: string): Definition | null {
  if (!local) {
    local = new Map(dictionary.map((w) => [w[0].toLowerCase(), w[1]]));
    seed.books.forEach((b) =>
      b.chapters.forEach((c) =>
        c.words.forEach((w) => {
          if (!local!.has(w[0].toLowerCase()))
            local!.set(w[0].toLowerCase(), w[1]);
        }),
      ),
    );
  }
  const w = word.toLowerCase().trim();
  const forms = [w];
  if (/ies$/.test(w)) forms.push(w.slice(0, -3) + "y");
  if (/(ches|shes|sses|xes|zes)$/.test(w)) forms.push(w.slice(0, -2));
  if (/s$/.test(w)) forms.push(w.slice(0, -1));
  if (/ied$/.test(w)) forms.push(w.slice(0, -3) + "y");
  for (const ending of ["ed", "ing", "er", "est"])
    if (w.endsWith(ending)) {
      const root = w.slice(0, -ending.length);
      forms.push(root, root + "e");
      if (/(.)\1$/.test(root)) forms.push(root.slice(0, -1));
    }
  for (const form of forms) {
    const translation = local.get(form);
    if (translation) return { translation, senses: [], source: "offline" };
  }
  return null;
}
export const isWord = (text: string): boolean =>
  /^[A-Za-z][A-Za-z'’-]*$/.test(text.trim());
export const audioUrl = (word: string): string =>
  "https://dict.youdao.com/dictvoice?audio=" +
  encodeURIComponent(word.trim()) +
  "&type=2";
async function youdao(word: string): Promise<Definition> {
  const value = record(
    await request(
      "https://dict.youdao.com/jsonapi?jsonversion=2&client=mobile&dicts=" +
        encodeURIComponent('{"count":1,"dicts":[["ec"]]}') +
        "&q=" +
        encodeURIComponent(word),
      { timeout: 8000 },
    ),
  );
  const words = record(value.ec).word;
  const item = record(Array.isArray(words) ? words[0] : words);
  const senses: string[] = [];
  if (Array.isArray(item.trs))
    item.trs.forEach((t) => {
      const tr = record(t).tr;
      if (Array.isArray(tr))
        tr.forEach((entry) => {
          const values = record(record(entry).l).i;
          if (Array.isArray(values))
            values.forEach((v) => {
              if (typeof v === "string" && v.trim()) senses.push(v);
            });
        });
    });
  if (!senses.length) throw new Error("词典未收录该词");
  return {
    source: "dict",
    translation: senses[0],
    senses: senses.slice(1),
    phonetic: [
      item.ukphone ? "英 /" + item.ukphone + "/" : "",
      item.usphone ? "美 /" + item.usphone + "/" : "",
    ]
      .filter(Boolean)
      .join("  "),
  };
}
async function fallback(word: string): Promise<Definition> {
  const data = await request<unknown>(
    "https://api.dictionaryapi.dev/api/v2/entries/en/" +
      encodeURIComponent(word),
    { timeout: 4000 },
  );
  const entries = Array.isArray(data) ? data.map(record) : [];
  const senses: string[] = [];
  entries.forEach((entry) => {
    if (Array.isArray(entry.meanings))
      entry.meanings.map(record).forEach((m) => {
        if (Array.isArray(m.definitions))
          m.definitions
            .slice(0, 2)
            .map(record)
            .forEach((d) => {
              if (typeof d.definition === "string")
                senses.push(String(m.partOfSpeech || "") + ". " + d.definition);
            });
      });
  });
  if (!senses.length) throw new Error("词典未收录该词");
  return {
    source: "dict",
    translation: senses[0],
    senses: senses.slice(1),
    phonetic: String(entries[0]?.phonetic || ""),
  };
}
export async function lookup(word: string): Promise<Definition> {
  const key = "dict_" + hash(word.trim().toLowerCase());
  const cached = storage.read<Definition | null>(key, null);
  if (cached?.translation) return cached;
  try {
    const result = await youdao(word).catch(() => fallback(word));
    try {
      storage.write(key, result);
    } catch {
      /* 词典缓存可重建 */
    }
    return result;
  } catch (error) {
    const result = storage.settings().localFallback ? offline(word) : null;
    if (result) return result;
    throw error;
  }
}
