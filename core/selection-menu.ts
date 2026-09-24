export interface SelectionRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** All coordinates are relative to the viewport, including its safe bounds. */
export function placeSelectionMenu(
  rects: SelectionRect[],
  menu: { width: number; height: number },
  viewport: { width: number; top: number; bottom: number },
) {
  const gap = 12;
  const visible = rects.filter(
    (r) => r.bottom > viewport.top && r.top < viewport.bottom,
  );
  if (!visible.length) return null;
  const first = visible[0];
  const last = visible[visible.length - 1];
  const below = last.bottom + gap;
  const above = first.top - gap - menu.height;
  const side = below + menu.height <= viewport.bottom ? "below" : "above";
  const anchor = side === "below" ? last : first;
  const center = (anchor.left + anchor.right) / 2;
  const left = Math.max(
    12,
    Math.min(center - menu.width / 2, viewport.width - menu.width - 12),
  );
  const top = Math.max(
    viewport.top,
    Math.min(side === "below" ? below : above, viewport.bottom - menu.height),
  );
  return {
    left,
    top,
    side,
    arrow: Math.max(18, Math.min(center - left, menu.width - 18)),
  };
}
