import * as storage from "./storage";
import { id } from "../core/models";
export interface Font {
  id: string;
  name: string;
  family: string;
  kind: "system" | "builtin" | "custom";
  file?: string;
  boldFile?: string;
  rel?: string;
  size?: number;
  createdAt?: number;
}
const system: Font[] = [
  {
    id: "system",
    name: "系统默认",
    family: "-apple-system, PingFang SC, sans-serif",
    kind: "system",
  },
  {
    id: "serif-sys",
    name: "系统衬线",
    family: "Georgia, Songti SC, serif",
    kind: "system",
  },
  {
    id: "mono-sys",
    name: "系统等宽",
    family: "Menlo, Consolas, monospace",
    kind: "system",
  },
];
const builtin: Font[] = [
  {
    id: "literata",
    name: "Literata",
    family: "EngReader Literata",
    kind: "builtin",
    file: "literata.ttf",
    boldFile: "literata-bold.ttf",
  },
];
const loaded = new Set<string>();
const pending = new Map<string, Promise<boolean>>();
export const list = (): Font[] => [
  ...system,
  ...builtin,
  ...storage
    .read<Font[]>("font_packs", [])
    .map((f) => ({ ...f, kind: "custom" as const })),
];
export const family = (key: string): string => {
  const value = list().find((f) => f.id === key);
  return !value || value.kind === "system"
    ? value?.family || system[0].family
    : `'${value.family}', Georgia, PingFang SC, serif`;
};
const absolute = (rel: string): string => wx.env.USER_DATA_PATH + "/" + rel;
function exists(path: string): boolean {
  try {
    wx.getFileSystemManager().accessSync(path);
    return true;
  } catch {
    return false;
  }
}
function loadFace(
  name: string,
  path: string,
  weight: string,
): Promise<boolean> {
  const key = name + weight;
  if (loaded.has(key)) return Promise.resolve(true);
  return new Promise((resolve) =>
    wx.loadFontFace({
      family: name,
      source: `url("${path}")`,
      global: true,
      desc: { weight },
      success: () => {
        loaded.add(key);
        resolve(true);
      },
      fail: () => resolve(false),
    }),
  );
}
export async function ensure(key: string): Promise<boolean> {
  const previous = pending.get(key);
  if (previous) return previous;
  const def = list().find((f) => f.id === key);
  if (!def || def.kind === "system") return true;
  const task = (async () => {
    try {
      if (def.kind === "custom")
        return await loadFace(def.family, absolute(def.rel || ""), "400");
      const fs = wx.getFileSystemManager();
      if (!exists(absolute("fonts"))) fs.mkdirSync(absolute("fonts"), true);
      const jobs = [def.file, def.boldFile]
        .filter((f): f is string => !!f)
        .map((file, i) => {
          const dest = absolute("fonts/builtin-" + file);
          if (!exists(dest))
            fs.copyFileSync("/fonts/" + def.id + "/" + file, dest);
          return loadFace(def.family, dest, i ? "700" : "400");
        });
      return (await Promise.all(jobs)).every(Boolean);
    } catch {
      return false;
    }
  })().finally(() => pending.delete(key));
  pending.set(key, task);
  return task;
}
export async function install(): Promise<Font> {
  const picked = await new Promise<WechatMiniprogram.ChooseFile>(
    (resolve, reject) =>
      wx.chooseMessageFile({
        count: 1,
        type: "file",
        extension: ["ttf", "otf", "woff"],
        success: (r) => resolve(r.tempFiles[0]),
        fail: reject,
      }),
  );
  const ext = picked.name.match(/\.(ttf|otf|woff)$/i)?.[1];
  if (!ext) throw new Error("请选择 ttf、otf 或 woff 字体");
  if (picked.size > 20 * 1024 * 1024) throw new Error("字体文件不能超过 20MB");
  const key = "f" + id();
  const rel = "fonts/" + key + "." + ext;
  const font: Font = {
    id: key,
    name: picked.name.replace(/\.[^.]+$/, ""),
    family: "EngCustom-" + key,
    kind: "custom",
    rel,
    size: picked.size,
    createdAt: Date.now(),
  };
  const fs = wx.getFileSystemManager();
  if (!exists(absolute("fonts"))) fs.mkdirSync(absolute("fonts"), true);
  fs.copyFileSync(picked.path, absolute(rel));
  try {
    if (!(await loadFace(font.family, absolute(rel), "400")))
      throw new Error("无法加载此字体");
    storage.write("font_packs", [
      ...storage.read<Font[]>("font_packs", []),
      font,
    ]);
  } catch (error) {
    fs.unlinkSync(absolute(rel));
    throw error;
  }
  return font;
}
export function remove(key: string): void {
  const custom = storage.read<Font[]>("font_packs", []);
  const font = custom.find((f) => f.id === key);
  if (!font) return;
  const s = storage.settings();
  storage.transaction({
    font_packs: custom.filter((f) => f.id !== key),
    settings: {
      ...s,
      fontRead: s.fontRead === key ? "system" : s.fontRead,
      fontUi: s.fontUi === key ? "system" : s.fontUi,
    },
  });
  try {
    wx.getFileSystemManager().unlinkSync(absolute(font.rel || ""));
  } catch {
    /* 索引已移除 */
  }
}
export function gc(): void {
  const custom = storage.read<Font[]>("font_packs", []);
  const kept = custom.filter((f) => !!f.rel && exists(absolute(f.rel)));
  if (kept.length !== custom.length) storage.write("font_packs", kept);
  try {
    const fs = wx.getFileSystemManager();
    fs.readdirSync(absolute("fonts"))
      .filter(
        (f) =>
          !f.startsWith("builtin-") &&
          !kept.some((k) => k.rel === "fonts/" + f),
      )
      .forEach((f) => fs.unlinkSync(absolute("fonts/" + f)));
  } catch {
    /* 尚未创建目录 */
  }
}
