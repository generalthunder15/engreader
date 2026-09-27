import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

test('reader preserves explicit word spaces without formatting each token onto a new line', () => {
  const template = readFileSync('pages/reader/reader.wxml', 'utf8');
  const paragraph = template.match(/<view class="english">([\s\S]*?)<\/view>/)?.[1] || '';
  assert.ok(paragraph.includes("{{token.after}}"), 'word spacing must survive formatting');
  assert.match(paragraph, />{{token\.w}}<\/text>/);
  assert.doesNotMatch(paragraph, /\r?\n/);
  const style = readFileSync('pages/reader/reader.wxss', 'utf8');
  const rule = style.match(/\.english\s*\{([^}]+)\}/)?.[1] || '';
  assert.match(rule, /white-space:\s*pre-wrap/);
});

test("all template handlers exist in TypeScript pages and components", () => {
  for (const root of ["pages", "components", "custom-tab-bar"]) {
    const dirs =
      root === "custom-tab-bar"
        ? [root]
        : readdirSync(root).map((d) => join(root, d));
    for (const dir of dirs)
      for (const file of readdirSync(dir).filter((f) => f.endsWith(".wxml"))) {
        const template = readFileSync(join(dir, file), "utf8");
        const path = join(dir, file.replace(".wxml", ".ts"));
        assert.ok(existsSync(path), path);
        const source = ts.createSourceFile(
          path,
          readFileSync(path, "utf8"),
          ts.ScriptTarget.Latest,
          true,
        );
        const methods = new Set<string>();
        function walk(node: ts.Node) {
          if (ts.isMethodDeclaration(node) && node.name)
            methods.add(node.name.getText(source));
          ts.forEachChild(node, walk);
        }
        walk(source);
        for (const match of template.matchAll(
          /\b(?:bind|catch):?[a-z]+="([\w]+)"/g,
        ))
          assert.ok(methods.has(match[1]), `${path} missing ${match[1]}`);
      }
  }
});
test("page routes exist and tab pages are never opened with navigateTo", () => {
  const app = JSON.parse(readFileSync("app.json", "utf8"));
  for (const page of app.pages)
    for (const ext of ["ts", "wxml", "wxss", "json"])
      assert.ok(existsSync(page + "." + ext), page + "." + ext);
  for (const dir of readdirSync("pages")) {
    const source = readFileSync(`pages/${dir}/${dir}.ts`, "utf8");
    assert.doesNotMatch(source, /navigate\(["'](?:quiz|shelf|study|mine)["']/);
    assert.doesNotMatch(
      source,
      /navigateTo\(\{\s*url:\s*["']\/pages\/(?:quiz|shelf|study|mine)\//,
    );
  }
});
