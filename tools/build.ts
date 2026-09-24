import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

const output = resolve("dist");
if (output !== join(process.cwd(), "dist"))
  throw new Error("Unexpected build directory");
rmSync(output, { recursive: true, force: true });
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc"], {
  stdio: "inherit",
});
function copyAssets(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) copyAssets(path);
    else if (/\.(wxml|wxss|json|svg|png|ttf|txt)$/.test(entry.name)) {
      mkdirSync(join("dist", dir), { recursive: true });
      cpSync(path, join("dist", path));
    }
  }
}
for (const dir of [
  "pages",
  "components",
  "custom-tab-bar",
  "fonts",
  "themes",
  "assets",
])
  if (existsSync(dir)) copyAssets(dir);
for (const file of ["app.json", "app.wxss", "sitemap.json"])
  cpSync(file, join("dist", file));
const config = JSON.parse(readFileSync("project.config.json", "utf8"));
config.miniprogramRoot = "dist/";
writeFileSync("project.config.json", JSON.stringify(config, null, 2) + "\n");
console.log("小程序已构建到 dist/");
