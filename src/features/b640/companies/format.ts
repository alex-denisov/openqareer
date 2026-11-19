import { pluralRu } from '../vacancies/format';

export { pluralRu };

const COUNT = new Intl.NumberFormat('ru-RU');

export const formatCount = (count: number): string => COUNT.format(count);

export const vacancyWord = (count: number): string => pluralRu(count, 'вакансия', 'вакансии', 'вакансий');

export const companyWord = (count: number): string => pluralRu(count, 'компания', 'компании', 'компаний');

/** «132 компании в подборке» — заголовок списка. */
export function companiesTitle(count: number): string {
  return `${companyWord(count)} в подборке`;
}

/** Буква аватара: первая буква названия без кавычек и знаков. */
export function companyInitial(name: string): string {
  const letter = name.replace(/[^\p{L}\p{N}]/gu, '').charAt(0);
  return letter ? letter.toLocaleUpperCase('ru-RU') : '·';
}

/** «11.11» — дата источника вакансии; чужая строка — пусто. */
export function shortDate(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return '';
  const date = new Date(time);
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}.${month}`;
}

/** Подпись ⓘ компании: отрасль, город, источники с датой. */
export function companyAbout(input: {
  readonly industry: string | null;
  readonly location: string | null;
  readonly sources: readonly { readonly name: string; readonly observedAt: string }[];
}): string {
  const lines: string[] = [];
  if (input.industry) lines.push(`Отрасль: ${input.industry}`);
  if (input.location) lines.push(`Город: ${input.location}`);
  const names = [...new Set(input.sources.map((source) => source.name))];
  const latest = input.sources.map((source) => source.observedAt).sort().at(-1);
  if (names.length) lines.push(`Источник: ${names.join(' и ')}${latest ? `, ${shortDate(latest)}` : ''}`);
  return lines.join(' · ');
}
