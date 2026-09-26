export interface DialogResult { confirm: boolean; content: string; tapIndex: number }
export interface DialogOptions { title?: string; content?: string; editable?: boolean; placeholderText?: string; showCancel?: boolean; confirmText?: string; itemList?: string[]; success?: (result: DialogResult) => void; fail?: () => void }
function show(options: DialogOptions): void {
  const pages = getCurrentPages();
  const host = pages[pages.length - 1]?.selectComponent("#app-dialog");
  if (!host) { wx.showToast({ title: options.content || "页面尚未准备好，请重试", icon: "none" }); options.fail?.(); return; }
  host.open(options, (result: DialogResult) => options.success?.(result));
}
export const showModal = show;
export function showActionSheet(options: DialogOptions): void {
  show({ ...options, success: result => { if (result.tapIndex >= 0) options.success?.(result); else options.fail?.(); } });
}
