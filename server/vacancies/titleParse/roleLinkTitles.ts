/**
 * Названия, которые нельзя связать с ролью: в них нет функции («Director», «Заместитель директора»,
 * «Vice President»), и модель на партии 04.11 выбирала роль наугад («Senior Director» в it-ops.vp).
 * Такие ключи остаются без роли, модель их не получает.
 */
const RANK_WORDS: ReadonlySet<string> = new Set([
  'director',
  'head',
  'manager',
  'vp',
  'vice',
  'president',
  'senior',
  'sr',
  'associate',
  'assistant',
  'deputy',
  'chief',
  'lead',
  'regional',
  'area',
  'of',
  'директор',
  'директора',
  'руководитель',
  'руководителя',
  'начальник',
  'начальника',
  'заместитель',
  'заведующий',
  'менеджер',
  'старший',
  'региональный',
  'территориальный',
  'отдела',
  'управления',
  'направления',
  'подразделения',
  'дивизиона',
  'департамента',
  'службы',
  'сектора',
  'группы',
]);

/** Отделение банка: своей роли нет, закрытый список предлагал только магазин. */
const BANK_OFFICE = /дополнительн\p{L}*\s+офис|отделени\p{L}*\s+банка/iu;

export function hasNoRoleToLink(titleKey: string): boolean {
  if (BANK_OFFICE.test(titleKey)) return true;
  const words = titleKey.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.length > 0 && words.every((word) => RANK_WORDS.has(word));
}
