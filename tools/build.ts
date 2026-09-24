import { execFileSync } from "node:child_process";
import {
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
// Keep watched directories alive so the WeChat IDE observes subsequent builds.
mkdirSync(output, { recursive: true });
const emitted = execFileSync(
  process.execPath,
  ["node_modules/typescript/bin/tsc", "--listEmittedFiles"],
  { encoding: "utf8" },
);
const expected = new Set(
  emitted
    .split(/\r?\n/)
    .filter((line) => line.startsWith("TSFILE: "))
    .map((line) => resolve(line.slice(8))),
);
function copyAsset(source: string) {
  const destination = resolve(output, source);
  mkdirSync(resolve(destination, ".."), { recursive: true });
  const contents = readFileSync(source);
  if (!existsSync(destination) || !readFileSync(destination).equals(contents))
    writeFileSync(destination, contents);
  expected.add(destination);
}
function copyAssets(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (dir === "fonts" && ["garamond", "inter"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) copyAssets(path);
    else if (/\.(wxml|wxss|json|svg|png|ttf|txt)$/.test(entry.name)) {
      copyAsset(path);
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
for (const file of ["app.json", "app.wxss", "sitemap.json"]) copyAsset(file);
// Remove obsolete outputs without deleting directories watched by the IDE.
function pruneStaleFiles(directory: string) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) pruneStaleFiles(path);
    else if (!expected.has(path)) rmSync(path);
  }
}
pruneStaleFiles(output);
const config = JSON.parse(readFileSync("project.config.json", "utf8"));
config.miniprogramRoot = "dist/";
writeFileSync("project.config.json", JSON.stringify(config, null, 2) + "\n");
console.log("小程序已构建到 dist/");
