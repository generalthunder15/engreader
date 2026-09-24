import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const compiler =
  process.env.WECHAT_COMPILER_DIR ||
  "C:/Program Files (x86)/Tencent/微信web开发者工具/resources/app.asar.unpacked/node_modules/wcc-exec";
function collect(root: string, extension: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? collect(join(root, e.name), extension)
      : e.name.endsWith(extension)
        ? [join(root, e.name).replace(/\\/g, "/")]
        : [],
  );
}
for (const extension of ["wxml", "wxss"]) {
  const files = ["pages", "components", "custom-tab-bar"].flatMap((dir) =>
    collect(dir, "." + extension),
  );
  if (extension === "wxss") files.unshift("app.wxss");
  const executable = join(
    compiler,
    extension === "wxml" ? "wcc.exe" : "wcsc.exe",
  );
  if (!existsSync(executable))
    throw new Error(
      "Set WECHAT_COMPILER_DIR to the WeChat wcc-exec directory.",
    );
  execFileSync(
    executable,
    [
      "-o",
      join(tmpdir(), "engreader-compiled-" + extension + ".txt"),
      ...files,
    ],
    { stdio: "pipe" },
  );
  console.log(
    `${files.length} ${extension} files compiled by WeChat successfully`,
  );
}
