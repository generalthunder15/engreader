import { message, UIEvent } from "../core/models";
export const toast = (title: string): void => {
  wx.showToast({ title, icon: "none" });
};
export const fail = (error: unknown): void => {
  wx.showModal({
    title: "操作未完成",
    content: message(error),
    showCancel: false,
  });
};
export const confirm = async (
  title: string,
  content: string,
): Promise<boolean> =>
  new Promise((resolve) =>
    wx.showModal({
      title,
      content,
      confirmText: "确认",
      success: (r) => resolve(r.confirm),
      fail: () => resolve(false),
    }),
  );
export const navigate = (
  path: string,
  params: Record<string, string> = {},
): void => {
  wx.navigateTo({
    url:
      "/pages/" +
      path +
      "/" +
      path +
      (Object.keys(params).length
        ? "?" +
          Object.entries(params)
            .map(([k, v]) => k + "=" + encodeURIComponent(v))
            .join("&")
        : ""),
  });
};
export const data = (e: UIEvent, key: string): string =>
  String(e.currentTarget.dataset[key] ?? "");
export const input = (e: UIEvent): string => String(e.detail.value ?? "");
export function cover(hue: number): string {
  return `background:linear-gradient(145deg,hsl(${hue},24%,42%),hsl(${hue},30%,25%))`;
}
