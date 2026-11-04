/** Отдельно от `letterLanguage`: проверка фактов идёт в Playwright, где JSON онтологии не грузится. */
export function hasCyrillic(text: string): boolean {
  return /\p{Script=Cyrillic}/u.test(text);
}
