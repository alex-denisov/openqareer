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
};

export function monthInputValue(value?: string): string {
  if (!value) return '';
  if (/^\d{4}-\d{2}$/u.test(value)) return value;
  if (/^\d{4}$/u.test(value)) return `${value}-01`;
  const match = value.trim().match(/^([а-яё.]+)\s+(\d{4})$/iu);
  const month = match?.[1]?.replace(/\.$/u, '').toLocaleLowerCase('ru');
  const monthNumber = month ? MONTH_PREFIX[month] : undefined;
  return match && monthNumber ? `${match[2]}-${monthNumber}` : '';
}

export function monthOrder(value?: string): number {
  const month = monthInputValue(value);
  return month ? Number(month.replace('-', '')) : 0;
}
