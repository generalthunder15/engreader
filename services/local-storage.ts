const JOURNAL = "storage_transaction_pending";
type Undo = { key: string; exists: boolean; value: unknown };
/** A process exit during a multi-key write is rolled back before the next read. */
export function recoverTransaction(): void {
  const pending = wx.getStorageSync(JOURNAL) as Undo[] | "";
  if (!pending) return;
  if (!Array.isArray(pending)) throw new Error("本地恢复记录损坏，请保留数据");
  for (const row of pending) {
    if (row.exists) wx.setStorageSync(row.key, row.value);
    else wx.removeStorageSync(row.key);
  }
  wx.removeStorageSync(JOURNAL);
}
export function read<T>(key: string, fallback: T): T {
  recoverTransaction();
  const value: unknown = wx.getStorageSync(key);
  return value === "" || value === null || value === undefined
    ? fallback
    : (value as T);
}
export function write(key: string, value: unknown): void {
  recoverTransaction();
  try {
    wx.setStorageSync(key, value);
  } catch {
    clearCache();
    try {
      wx.setStorageSync(key, value);
    } catch {
      throw new Error("保存失败：本地空间不足，请先备份并清理缓存");
    }
  }
}
export function clearCache(): void {
  wx.getStorageInfoSync()
    .keys.filter((k) => k === "ai_cache" || /^(ai2_|dict_|tts_)/.test(k))
    .forEach((k) => wx.removeStorageSync(k));
  try {
    const fs = wx.getFileSystemManager();
    fs.readdirSync(wx.env.USER_DATA_PATH)
      .filter((k) => /^tts_/.test(k))
      .forEach((k) => fs.unlinkSync(wx.env.USER_DATA_PATH + "/" + k));
  } catch {
    /* 无音频缓存 */
  }
}
/** Commit related keys together; restore the previous values if a write fails. */
export function transaction(
  values: Record<string, unknown>,
  removed: string[] = [],
): void {
  recoverTransaction();
  const keys = [...new Set([...Object.keys(values), ...removed])];
  if (keys.includes(JOURNAL)) throw new Error("不能覆盖事务恢复记录");
  const existing = new Set(wx.getStorageInfoSync().keys);
  const previous: Undo[] = keys.map((key) => ({
    key,
    exists: existing.has(key),
    value: wx.getStorageSync(key),
  }));
  // If this write fails, no live data has been touched.
  wx.setStorageSync(JOURNAL, previous);
  try {
    Object.entries(values).forEach(([key, value]) =>
      wx.setStorageSync(key, value),
    );
    removed.forEach((key) => wx.removeStorageSync(key));
    wx.removeStorageSync(JOURNAL);
  } catch {
    try {
      recoverTransaction();
    } catch {
      throw new Error("保存中断，恢复记录已保留，请释放空间后重新打开");
    }
    throw new Error("保存未完成，原数据已恢复。请清理空间后重试");
  }
}
