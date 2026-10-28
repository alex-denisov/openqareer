const MONTH_PREFIX: Readonly<Record<string, string>> = {
  янв: '01',
  январь: '01',
  фев: '02',
  февраль: '02',
  мар: '03',
  март: '03',
  апр: '04',
  апрель: '04',
  май: '05',
  июн: '06',
  июнь: '06',
  июл: '07',
  июль: '07',
  авг: '08',
  август: '08',
  сен: '09',
  сентябрь: '09',
  окт: '10',
  октябрь: '10',
  ноя: '11',
  ноябрь: '11',
  дек: '12',
  декабрь: '12',
  jan: '01',
  january: '01',
  feb: '02',
  february: '02',
  mar: '03',
  march: '03',
  apr: '04',
  april: '04',
  may: '05',
  jun: '06',
  june: '06',
  jul: '07',
  july: '07',
  aug: '08',
  august: '08',
  sep: '09',
  sept: '09',
  september: '09',
  oct: '10',
  october: '10',
  nov: '11',
  november: '11',
  dec: '12',
  december: '12',
};

export function monthInputValue(value?: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}(?:-\d{2})?$/u.test(value)) return value.slice(0, 7);
  if (/^\d{4}$/u.test(value)) return `${value}-01`;
  const match = value.trim().match(/^([a-zа-яё.]+)\s+(\d{4})$/iu);
  const month = match?.[1]?.replace(/\.$/u, '').toLocaleLowerCase('ru');
  const monthNumber = month ? MONTH_PREFIX[month] : undefined;
  return match && monthNumber ? `${match[2]}-${monthNumber}` : '';
}

export function monthOrder(value?: string): number {
  const month = monthInputValue(value);
  return month ? Number(month.replace('-', '')) : 0;
}

/** Месяц по макету «Профиля»: «03.2021»; год без месяца и непонятный текст остаются как есть. */
export function displayMonth(value: string): string {
  if (/^\d{4}$/u.test(value.trim())) return value.trim();
  const month = monthInputValue(value);
  return month ? `${month.slice(5, 7)}.${month.slice(0, 4)}` : value;
}

/** Образование в макете — только годы: «2008 — 2013». */
export function displayYear(value?: string): string {
  return value?.match(/\d{4}/u)?.[0] ?? value ?? '';
}
