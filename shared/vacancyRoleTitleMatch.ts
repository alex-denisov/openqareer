/**
 * Один и тот же признак «заголовок вакансии похож на роль» — сервер считает
 * им вакансий на роль кампании (`countMatchedVacanciesByRole`), а экран
 * «Вакансии» тем же признаком выбирает записи под выбранный чип роли
 * (B248). Общее место, а не два похожих правила: разошедшиеся версии дали
 * бы разный счёт в баннере «N совпадений» и в списке под тем же фильтром.
 */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s.]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Фраза `part` целиком, словами подряд: «cto» не находится внутри «director» (B766). */
function containsPhrase(words: readonly string[], part: readonly string[]): boolean {
  if (part.length === 0 || part.length > words.length) return false;
  for (let start = 0; start + part.length <= words.length; start += 1) {
    if (part.every((word, index) => words[start + index] === word)) return true;
  }
  return false;
}

export function titleMatchesRole(title: string, role: string): boolean {
  const titleWords = normalize(title).split(' ').filter(Boolean);
  const roleWords = normalize(role).split(' ').filter(Boolean);
  if (roleWords.length === 0) return false;
  if (containsPhrase(titleWords, roleWords) || containsPhrase(roleWords, titleWords)) return true;
  const known = new Set(titleWords);
  return roleWords.filter((word) => known.has(word)).length >= 2;
}
