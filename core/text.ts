import { Paragraph, Token, Tokens } from "./models";
export function optionLabel(text: string, index: number): string {
  const label = String.fromCharCode(65 + index);
  const hasLabel = new RegExp(`^\\s*(?:${label}[.．、:：)）]|[（(]${label}[)）])`, "i");
  return hasLabel.test(text) ? text : `${label}. ${text}`;
}
const abbreviations = new Set(
  "mr mrs ms dr prof st jr sr vs etc eg ie no fig inc ltd co corp gen col capt sgt rev hon approx dept vol pp al cf ed eds gov sen rep univ bros est".split(
    " ",
  ),
);
export function splitSentences(input: string): string[] {
  const text = input.replace(/\s+/g, " ").trim();
  const result: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!/[.!?…]/.test(text[i])) continue;
    if (text[i] === ".") {
      const word = text.slice(0, i).match(/([A-Za-z]+)$/)?.[1] || "";
      if (
        (/\d/.test(text[i - 1] || "") && /\d/.test(text[i + 1] || "")) ||
        word.length === 1 ||
        abbreviations.has(word.toLowerCase()) ||
        (word.length <= 2 && text[i - word.length - 1] === ".")
      )
        continue;
    }
    while (i + 1 < text.length && /[.!?…"'”’)\]]/.test(text[i + 1])) i++;
    const sentence = text.slice(start, i + 1).trim();
    if (sentence) result.push(sentence);
    start = i + 1;
  }
  if (text.slice(start).trim()) result.push(text.slice(start).trim());
  return result;
}
export function spaceBetween(left: string, right: string): boolean {
  return (
    !!right && !/^[,.!?;:%…'"\)\]”’]+$/.test(right) && !/^[('“\[]+$/.test(left)
  );
}
export function tokenize(content: string): Tokens {
  let index = 0;
  const sentences = content.split(/\n+/).flatMap(splitSentences);
  const paragraphs: Paragraph[] = sentences.map((sentence, sid) => {
    const words =
      sentence.match(
        /[A-Za-z]+(?:['’-][A-Za-z]+)*|\d+(?:[.,]\d+)*|[^\sA-Za-z0-9]/g,
      ) || [];
    return {
      pid: sid,
      tokens: words.map((w, i) => ({
        id: index++,
        sid,
        w,
        sp: spaceBetween(w, words[i + 1] || ""),
      })),
    };
  });
  return { paragraphs, sentences, tokenCount: index };
}
export function joinTokens(tokens: Token[]): string {
  return tokens
    .map((t, i) => t.w + (spaceBetween(t.w, tokens[i + 1]?.w || "") ? " " : ""))
    .join("");
}
export function chunks(text: string, size = 3500): string[] {
  const result: string[] = [];
  let pending = "";
  for (const sentence of text.split(/\n+/).flatMap(splitSentences)) {
    if (pending && pending.length + sentence.length > size) {
      result.push(pending);
      pending = "";
    }
    if (sentence.length > size) {
      for (let i = 0; i < sentence.length; i += size)
        result.push(sentence.slice(i, i + size));
    } else pending += (pending ? " " : "") + sentence;
  }
  if (pending) result.push(pending);
  return result;
}
