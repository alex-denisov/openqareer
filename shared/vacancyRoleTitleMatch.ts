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

export function titleMatchesRole(title: string, role: string): boolean {
  const titleNorm = normalize(title);
  const roleNorm = normalize(role);
  if (!roleNorm) return false;
  if (titleNorm.includes(roleNorm) || roleNorm.includes(titleNorm)) return true;
  const overlap = roleNorm.split(' ').filter((word) => titleNorm.includes(word)).length;
  return overlap >= 2;
}
