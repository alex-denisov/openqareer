/**
 * d01h: компании из откликов кандидата для поля «Компания» формы плана
 * адаптации и обязанности из текста вакансии для «Что от вас ждут».
 */

/** Сколько знаков «Что от вас ждут» принимает сервер. */
export const EXPECTATIONS_MAX = 1500;
const MIN_QUERY = 2;
const MAX_SUGGESTIONS = 5;

/** Поля отклика, которые нужны подсказке (подмножество `ApplicationView`). */
export interface ResponseLike {
  readonly clusterId: string | null;
  readonly stage: string;
  readonly createdAt: string;
  readonly appliedAt?: string | null;
  readonly offer?: unknown;
  readonly vacancy: {
    readonly title: string;
    readonly company: string;
    readonly companyHidden?: boolean;
  } | null;
}

export interface CompanySuggestion {
  readonly key: string;
  readonly company: string;
  readonly title: string;
  /** «Руководитель разработки · отклик 12.11» или «… · оффер». */
  readonly line: string;
  readonly clusterId: string | null;
}

const normalize = (value: string) => value.trim().toLocaleLowerCase('ru-RU');

function dayMonth(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}`;
}

interface Ranked extends CompanySuggestion {
  readonly hasOffer: boolean;
  readonly at: string;
}

function rank(item: ResponseLike): Ranked | null {
  const vacancy = item.vacancy;
  if (!vacancy || vacancy.companyHidden || !vacancy.company.trim()) return null;
  const hasOffer = Boolean(item.offer) || item.stage === 'offer';
  const at = item.appliedAt ?? item.createdAt;
  return {
    key: `${normalize(vacancy.company)}|${normalize(vacancy.title)}`,
    company: vacancy.company.trim(),
    title: vacancy.title.trim(),
    line: `${vacancy.title.trim()} · ${hasOffer ? 'оффер' : `отклик ${dayMonth(at)}`}`,
    clusterId: item.clusterId,
    hasOffer,
    at,
  };
}

/** Компании из откликов по началу или части названия: сначала оффер, потом новые. */
export function companySuggestions(
  responses: readonly ResponseLike[],
  query: string,
): readonly CompanySuggestion[] {
  const typed = normalize(query);
  if (typed.length < MIN_QUERY) return [];
  const seen = new Set<string>();
  const matches = responses
    .map(rank)
    .filter((item): item is Ranked => item !== null && normalize(item.company).includes(typed))
    .sort((left, right) => Number(right.hasOffer) - Number(left.hasOffer) || right.at.localeCompare(left.at))
    .filter((item) => !seen.has(item.key) && Boolean(seen.add(item.key)));
  if (matches.every((item) => normalize(item.company) === typed)) return [];
  return matches
    .slice(0, MAX_SUGGESTIONS)
    .map(({ key, company, title, line, clusterId }) => ({ key, company, title, line, clusterId }));
}

/** Конец заголовка: `\b` в JS не видит границу кириллического слова. */
const HEAD_END = String.raw`(?=[\s:.!—-]|$)`;
const DUTIES_HEAD = new RegExp(
  `^(задачи|обязанности|чем (предстоит|вы будете|нужно) заниматься|что (нужно|предстоит) делать|функционал|зона ответственности)${HEAD_END}`,
  'iu',
);
const OTHER_HEAD = new RegExp(
  `^(требования|условия|мы предлагаем|предлагаем|ожида(ем|ния)|что мы (ждём|ждем|ожидаем)|будет плюсом|о компании|кого мы ищем|навыки)${HEAD_END}`,
  'iu',
);
const BULLET = /^[\s•·\-–—*]+/u;

const lines = (text: string) => text.split('\n').map((line) => line.replace(BULLET, '').trim()).filter(Boolean);

function dutiesSection(description: string): string[] {
  const all = lines(description);
  const start = all.findIndex((line) => DUTIES_HEAD.test(line));
  if (start < 0) return [];
  const rest = all.slice(start + 1);
  const end = rest.findIndex((line) => OTHER_HEAD.test(line));
  return end < 0 ? rest : rest.slice(0, end);
}

/** Текст не длиннее предела, обрезанный по целой строке. */
function fit(parts: readonly string[]): string {
  const kept: string[] = [];
  let length = 0;
  for (const part of parts) {
    const next = length + part.length + (kept.length ? 1 : 0);
    if (next > EXPECTATIONS_MAX) break;
    kept.push(part);
    length = next;
  }
  return kept.join('\n');
}

/** Обязанности вакансии: выделенные сервером, иначе раздел «Задачи», иначе начало текста. */
export function dutiesFromVacancy(detail: {
  readonly description: string;
  readonly responsibilities: readonly string[];
}): string {
  const picked = detail.responsibilities.map((item) => item.trim()).filter(Boolean);
  if (picked.length > 0) return fit(picked);
  const section = dutiesSection(detail.description);
  return fit(section.length > 0 ? section : lines(detail.description));
}
