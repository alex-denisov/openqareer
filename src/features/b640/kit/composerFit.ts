const MAX_ROWS = 13;

/** Высота поля по тексту, не больше 13 строк; ставится через CSSOM. */
export function fitComposerHeight(area: HTMLTextAreaElement): void {
  const style = getComputedStyle(area);
  const lineHeight = parseFloat(style.lineHeight);
  const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
  const edges = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + border;
  area.style.height = 'auto';
  if (!Number.isFinite(lineHeight) || !Number.isFinite(edges)) return;
  const max = MAX_ROWS * lineHeight + edges;
  const full = area.scrollHeight + border;
  area.style.height = `${Math.min(full, max)}px`;
  area.style.overflowY = full > max + 0.5 ? 'auto' : 'hidden';
}
