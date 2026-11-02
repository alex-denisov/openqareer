export interface ResumeMonth {
  readonly year: number;
  readonly month: number;
}

const ENGLISH_MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const RUSSIAN_MONTHS: readonly (readonly string[])[] = [
  ['январь', 'января'],
  ['февраль', 'февраля'],
  ['март', 'марта'],
  ['апрель', 'апреля'],
  ['май', 'мая'],
  ['июнь', 'июня'],
  ['июль', 'июля'],
  ['август', 'августа'],
  ['сентябрь', 'сентября'],
  ['октябрь', 'октября'],
  ['ноябрь', 'ноября'],
  ['декабрь', 'декабря'],
];

const MONTH_BY_NAME: ReadonlyMap<string, number> = buildMonthNames();

function buildMonthNames(): Map<string, number> {
  const names = new Map<string, number>();
  ENGLISH_MONTHS.forEach((name, index) => {
    names.set(name, index + 1);
    names.set(name.slice(0, 3), index + 1);
  });
  names.set('sept', 9);
  RUSSIAN_MONTHS.forEach((forms, index) => {
    for (const form of forms) names.set(form, index + 1);
    names.set(forms[0]!.slice(0, 3), index + 1);
  });
  names.set('сент', 9);
  return names;
}

const OPEN_ENDED = new Set([
  'present',
  'now',
  'current',
  'по настоящее время',
  'н. в.',
  'н.в.',
  'настоящее время',
]);

export function isOpenEndedDate(value: string): boolean {
  return OPEN_ENDED.has(value.trim().toLowerCase());
}

function valid(year: number, month: number): ResumeMonth | null {
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/** Parses ISO, "Nov 2025", "ноября 2025", "11.2025", "11/2025" and "2016". Year alone is month 1. */
export function parseResumeMonth(value: string | null | undefined): ResumeMonth | null {
  const text = value?.trim().toLowerCase();
  if (!text) return null;
  const iso = /^(\d{4})-(\d{2})(?:-(0[1-9]|[12]\d|3[01]))?$/u.exec(text);
  if (iso) return valid(Number(iso[1]), Number(iso[2]));
  const numeric = /^(0?[1-9]|1[0-2])[./](\d{4})$/u.exec(text);
  if (numeric) return valid(Number(numeric[2]), Number(numeric[1]));
  if (/^\d{4}$/u.test(text)) return { year: Number(text), month: 1 };
  const named = /^([a-zа-яё]+)\.?\s+(\d{4})$/u.exec(text);
  if (!named) return null;
  const month = MONTH_BY_NAME.get(named[1]!);
  return month ? { year: Number(named[2]), month } : null;
}
