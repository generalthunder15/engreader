import { record } from "../core/models";
import { settings } from "./storage";
export class NetworkError extends Error {
  constructor(
    message: string,
    readonly kind: "domain" | "timeout" | "network" | "http",
    readonly status = 0,
  ) {
    super(message);
  }
}
export function networkError(error: { errMsg?: string }): NetworkError {
  const text = error.errMsg || "";
  if (/domain|url not in/i.test(text))
    return new NetworkError(
      "请求域名未获微信允许，请检查小程序的合法域名配置",
      "domain",
    );
  if (/timeout/i.test(text))
    return new NetworkError("请求超时，请稍后重试", "timeout");
  return new NetworkError("网络连接失败，请检查连接后重试", "network");
}
export function request<T>(
  url: string,
  options: {
    method?: "GET" | "POST";
    data?: object;
    key?: string;
    timeout?: number;
    responseType?: "text" | "arraybuffer";
  } = {},
): Promise<T> {
  return new Promise((resolve, reject) =>
    wx.request({
      url,
      method: options.method || "GET",
      data: options.data,
      timeout: options.timeout || 30000,
      responseType: options.responseType || "text",
      header: {
        "Content-Type": "application/json",
        ...(options.key ? { Authorization: "Bearer " + options.key } : {}),
      },
      success: (response) => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          const body = record(response.data);
          const reason = record(body.error).message || body.message;
          reject(
            new NetworkError(
              typeof reason === "string"
                ? reason
                : "服务返回 HTTP " + response.statusCode,
              "http",
              response.statusCode,
            ),
          );
        } else resolve(response.data as T);
      },
      fail: (error) => reject(networkError(error)),
    }),
  );
}
export function endpoint(base: string, path = "/chat/completions"): string {
  let root = base.trim().replace(/\/+$/, "");
  if (/^https:\/\/api\.siliconflow\.cn$/i.test(root)) root += '/v1';
  if (!/^https?:\/\/[^/\s]+/i.test(root))
    throw new Error("请填写有效的接口地址");
  return root.endsWith(path) ? root : root + path;
}
export interface Probe {
  url: string;
  name: string;
  optional: boolean;
  ok: boolean;
  detail: string;
}
export function endpoints(): {
  url: string;
  name: string;
  optional: boolean;
}[] {
  const s = settings();
  return [
    { url: s.baseUrl, name: "主模型", optional: false },
    ...(s.sfApiKey
      ? [{ url: s.sfBaseUrl, name: "辅助模型", optional: true }]
      : []),
    {
      url: "https://dict.youdao.com/jsonapi?q=hello",
      name: "有道词典",
      optional: false,
    },
    {
      url: "https://api.dictionaryapi.dev/api/v2/entries/en/hello",
      name: "备用词典",
      optional: true,
    },
  ];
}
export const domainList = (): string =>
  [
    ...new Set([
      ...endpoints().map((d) => d.url.match(/^https?:\/\/([^/]+)/)?.[1] || ""),
      "fanyi.baidu.com",
      "dashscope.aliyuncs.com",
      "dashscope-result-bj.oss-cn-beijing.aliyuncs.com",
    ]),
  ]
    .filter(Boolean)
    .join("\n");
export async function diagnose(): Promise<Probe[]> {
  return Promise.all(
    endpoints().map(async (entry) => {
      const started = Date.now();
      try {
        await request(entry.url, { timeout: 8000 });
        return {
          ...entry,
          ok: true,
          detail: `可连接 · ${Date.now() - started}ms`,
        };
      } catch (error) {
        if (error instanceof NetworkError && error.kind === "http")
          return {
            ...entry,
            ok: true,
            detail: `可连接 · HTTP ${error.status}（不代表鉴权或模型可用）`,
          };
        return {
          ...entry,
          ok: false,
          detail: error instanceof Error ? error.message : "连接失败",
        };
      }
    }),
  );
}
