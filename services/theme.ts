import * as storage from "./storage";
import * as fonts from "./fonts";
export const themes = [
  { id: "default", name: "晴空", color: "#416C64" },
  { id: "sepia", name: "纸间", color: "#9B774B" },
  { id: "night", name: "夜读", color: "#82B8AD" },
];
export function current(): {
  style: string;
  id: string;
  primary: string;
  bg: string;
  fontId: string;
} {
  const s = storage.settings();
  const mode = themes.some((t) => t.id === s.theme) ? s.theme : "default";
  const palettes: Record<string, string[]> = {
    default: [
      "#F5F7F5",
      "#FFFFFF",
      "#203530",
      "#70817B",
      "#E3EAE6",
      "#416C64",
      "#E9F1ED",
    ],
    sepia: [
      "#F5EFE3",
      "#FFF9EE",
      "#493B2D",
      "#8B7962",
      "#E6DAC7",
      "#9B774B",
      "#F0E5D2",
    ],
    night: [
      "#141E1C",
      "#1E2B27",
      "#E2EBE6",
      "#9CAC9F",
      "#30423A",
      "#82B8AD",
      "#2B4038",
    ],
  };
  const p = palettes[mode];
  const requested =
    s.fontRead === "theme"
      ? mode === "sepia"
        ? "literata"
        : mode === "night"
          ? "literata"
          : "system"
      : s.fontRead;
  const fontId = fonts.list().some((f) => f.id === requested)
    ? requested
    : "system";
  const tokens: Record<string, string> = {
    bg: p[0],
    card: p[1],
    text: p[2],
    muted: p[3],
    line: p[4],
    primary: p[5],
    soft: p[6],
    danger: mode === "night" ? "#F0958C" : "#B95046",
    "on-primary": mode === "night" ? "#14241D" : "#FFFFFF",
    "font-read": fonts.family(fontId),
    "font-ui": fonts.family(s.fontUi),
    "read-size": (s.readFontSize || 36) + "rpx",
    "read-line": String(s.readLineHeight || 2.1),
    "read-indent": (s.readIndent < 0 ? 34 : s.readIndent) + "rpx",
  };
  return {
    id: mode,
    style: Object.entries(tokens)
      .map(([k, v]) => `--${k}:${v}`)
      .join(";"),
    primary: p[5],
    bg: p[0],
    fontId,
  };
}
export interface ThemePage {
  setData(data: Record<string, unknown>): void;
  getTabBar?: () => { setData(data: Record<string, unknown>): void };
}
export function bind(page: ThemePage, selected = -1): void {
  const t = current();
  page.setData({ themeStyle: t.style, themeId: t.id, themePrimary: t.primary });
  wx.setNavigationBarColor({
    frontColor: t.id === "night" ? "#ffffff" : "#000000",
    backgroundColor: t.bg,
  });
  wx.setBackgroundColor({
    backgroundColor: t.bg,
    backgroundColorTop: t.bg,
    backgroundColorBottom: t.bg,
  });
  void fonts.ensure(t.fontId);
  void fonts.ensure(storage.settings().fontUi);
  if (selected >= 0)
    page.getTabBar?.()?.setData({ selected, themeStyle: t.style });
}
