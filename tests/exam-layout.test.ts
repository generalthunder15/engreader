import test from "node:test";
import assert from "node:assert/strict";
import { optionColumns } from "../core/exam-layout";
import { optionLabel } from "../core/text";
test("option layout chooses four, two, or one columns from measured text widths", () => {
  assert.equal(optionColumns(320, [30, 35, 40, 32], 18, 6), 4);
  assert.equal(optionColumns(320, [30, 110, 40, 32], 18, 6), 2);
  assert.equal(optionColumns(320, [30, 180, 40, 32], 18, 6), 1);
  assert.equal(optionColumns(200, [30, 110, 40, 32], 18, 6), 1);
});
test("option display preserves an AI label and supplies it only when missing", () => {
  assert.equal(optionLabel("A. milk", 0), "A. milk");
  assert.equal(optionLabel("B、water", 1), "B、water");
  assert.equal(optionLabel("tea", 2), "C. tea");
});
