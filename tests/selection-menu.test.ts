import test from "node:test";
import assert from "node:assert/strict";
import { placeSelectionMenu } from "../core/selection-menu";

const viewport = { width: 390, top: 88, bottom: 800 };
const menu = { width: 366, height: 66 };

test("selection menu sits just below the final line of a multiline selection", () => {
  const position = placeSelectionMenu(
    [
      { left: 30, right: 360, top: 200, bottom: 230 },
      { left: 30, right: 150, top: 240, bottom: 270 },
    ],
    menu,
    viewport,
  )!;
  assert.equal(position.top, 282);
  assert.equal(position.side, "below");
  assert.equal(position.left + position.arrow, 90);
});

test("selection menu flips above text near the bottom safe area", () => {
  const rect = { left: 160, right: 220, top: 740, bottom: 770 };
  const position = placeSelectionMenu([rect], menu, viewport)!;
  assert.equal(position.side, "above");
  assert.equal(position.top + menu.height, rect.top - 12);
});

test("selection menu and arrow stay inside the viewport at either horizontal edge", () => {
  for (const left of [0, 365]) {
    const position = placeSelectionMenu(
      [{ left, right: left + 25, top: 200, bottom: 225 }],
      menu,
      viewport,
    )!;
    assert.ok(position.left >= 12);
    assert.ok(position.left + menu.width <= viewport.width - 12);
    assert.ok(position.arrow >= 18 && position.arrow <= menu.width - 18);
  }
});

test("selection menu follows scrolling and hides when the selection is offscreen", () => {
  const rect = { left: 40, right: 120, top: 300, bottom: 330 };
  const initial = placeSelectionMenu([rect], menu, viewport)!;
  const scrolled = placeSelectionMenu(
    [{ ...rect, top: 200, bottom: 230 }],
    menu,
    viewport,
  )!;
  assert.equal(initial.top - scrolled.top, 100);
  assert.equal(
    placeSelectionMenu([{ ...rect, top: 30, bottom: 60 }], menu, viewport),
    null,
  );
  assert.equal(placeSelectionMenu([], menu, viewport), null);
});

test("selection taller than the viewport keeps menu within safe bounds", () => {
  const position = placeSelectionMenu(
    [
      { left: 30, right: 350, top: -20, bottom: 110 },
      { left: 30, right: 350, top: 770, bottom: 850 },
    ],
    menu,
    viewport,
  )!;
  assert.ok(position.top >= viewport.top);
  assert.ok(position.top + menu.height <= viewport.bottom);
});
