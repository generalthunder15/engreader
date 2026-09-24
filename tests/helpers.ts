export function installStorage() {
  const values = new Map<string, unknown>();
  let failingKey = "";
  const wx = {
    getStorageSync(key: string) {
      return values.has(key) ? structuredClone(values.get(key)) : "";
    },
    setStorageSync(key: string, value: unknown) {
      if (key === failingKey) {
        failingKey = "";
        throw new Error("quota");
      }
      values.set(key, structuredClone(value));
    },
    removeStorageSync(key: string) {
      values.delete(key);
    },
    getStorageInfoSync() {
      return { keys: [...values.keys()] };
    },
    env: { USER_DATA_PATH: "/user" },
    getFileSystemManager() {
      return { readdirSync: () => [], unlinkSync: () => {} };
    },
    showToast() {},
    showModal() {},
  };
  Object.assign(globalThis, { wx });
  return {
    values,
    wx,
    failOnce(key: string) {
      failingKey = key;
    },
  };
}
