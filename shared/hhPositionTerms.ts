/** Условия поиска из старых снимков («Уровень дохода не указан · Постоянная работа …») — не «О себе». */
export function isPositionTerms(text: string): boolean {
  if (/^\s*уровень дохода не указан/iu.test(text)) return true;
  const terms = text.match(
    /постоянная работа|подработка|полная занятость|частичная занятость|гибрид|удал[её]нно|на месте работодателя|командировк/giu,
  );
  return text.length < 300 && (terms?.length ?? 0) >= 3;
}
