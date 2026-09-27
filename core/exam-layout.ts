/** Prefer four columns, then two, only when every label fits without wrapping. */
export function optionColumns(width: number, labelWidths: number[], padding: number, gap: number): number {
  const needed = Math.max(0, ...labelWidths) + padding;
  for (const columns of [4, 2]) if ((width - gap * (columns - 1)) / columns >= needed) return columns;
  return 1;
}
