import * as store from "./storage";
import { AI_BOOK } from "../core/learning";
import { bookOutline } from "../core/book-outline";
import { load } from "./learning";
export function bookView(id: string) {
  const book = store.book(id);
  return book ? bookOutline(book, id === AI_BOOK ? load().sessions.filter(s => s.kind === "lesson") : []) : null;
}
