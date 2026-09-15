import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { extractAtsLink } from './vacancyDeduplicator';

/**
 * B221 — вопросы к пулу, на которые хранилище отвечает само, не поднимая пул в
 * кучу. Здесь лежит то, что обе реализации (SQLite и память) обязаны считать
 * одинаково: окно свежести, поисковая строка записи, порядок выдачи.
 */

/** Сколько дней пул держит объявление; дальше его снимает уборка. */
export const MAX_VACANCY_AGE_DAYS = 30;

/**
 * Окно свежести в миллисекундах: дата публикации не старше `fromMs` и не из
 * будущего — дата позже «сейчас» это ошибка площадки, а не новинка.
 */
export interface FreshnessWindow {
  readonly fromMs: number;
  readonly toMs: number;
}

export function freshnessWindow(
  nowMs: number = Date.now(),
  maxAgeDays: number = MAX_VACANCY_AGE_DAYS,
): FreshnessWindow {
  return { fromMs: nowMs - maxAgeDays * 24 * 60 * 60 * 1000, toMs: nowMs };
}

export interface VacancyPoolQuery {
  readonly window: FreshnessWindow;
  /** Пустой список — пустой ответ: фильтр по типу, которому не соответствует ни одна площадка. */
  readonly sourceIds?: readonly string[];
  readonly isRemote?: boolean;
  /** Подстрока без учёта регистра по названию, работодателю, навыкам и описанию. */
  readonly query?: string;
  readonly offset: number;
  readonly limit: number;
}

export interface VacancyPoolPage {
  readonly total: number;
  readonly items: UnifiedVacancy[];
}

/** Миллисекунды даты или `undefined`, если строка не читается как дата. */
export function parseMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

export function isWithin(publishedMs: number | undefined, window: FreshnessWindow): boolean {
  return publishedMs !== undefined && publishedMs >= window.fromMs && publishedMs <= window.toMs;
}

/**
 * Поисковая строка записи считается один раз при записи, а не на каждый
 * запрос: `lower()` SQLite знает только латиницу, поэтому регистр снимается
 * здесь, на стороне JavaScript, для любого алфавита.
 */
export function searchTextOf(vacancy: UnifiedVacancy): string {
  // Записи из базы прошли только базовую проверку формы: отсутствующий
  // список навыков или описание — не повод ронять индексацию.
  const skills = Array.isArray(vacancy.requiredSkills) ? vacancy.requiredSkills : [];
  return [vacancy.title, vacancy.company ?? '', ...skills, vacancy.description ?? '']
    .join('\n')
    .toLowerCase();
}

/** Столько знаков описания несёт кластер (`descriptionSummary`). */
export const CLUSTER_SUMMARY_CHARS = 300;

/**
 * Вход сведения: та часть записи, которую кластеры читают на самом деле.
 * Полные тексты объявления сведению не нужны, а разбирать их на каждую
 * сборку — 1,2 ГБ мусора на 173 000 записей: на VM прода этого хватало,
 * чтобы сборщик мусора останавливал процесс на десятки секунд (B221, выкат
 * 2026-09-15). Проекция считается один раз при записи и лежит в узкой
 * таблице индекса.
 *
 * Описание урезано до сводки кластера; ATS-ссылка, если она была дальше в
 * тексте, дописывается за сводкой, чтобы правило «одна и та же вакансия по
 * ATS-ссылке» продолжало работать.
 */
export function clusterProjectionOf(vacancy: UnifiedVacancy): UnifiedVacancy {
  const description = vacancy.description ?? '';
  const summary = description.slice(0, CLUSTER_SUMMARY_CHARS);
  const atsLink = extractAtsLink(description);
  const skills = Array.isArray(vacancy.requiredSkills) ? vacancy.requiredSkills : [];
  return {
    id: vacancy.id,
    fingerprint: vacancy.fingerprint,
    title: vacancy.title,
    company: vacancy.company ?? '',
    ...(vacancy.location === undefined ? {} : { location: vacancy.location }),
    ...(vacancy.isRemote === undefined ? {} : { isRemote: vacancy.isRemote }),
    ...(vacancy.salary === undefined ? {} : { salary: vacancy.salary }),
    description: atsLink && !summary.includes(atsLink) ? `${summary}\n${atsLink}` : summary,
    requiredSkills: [...skills],
    url: typeof vacancy.url === 'string' ? vacancy.url : '',
    provenance: vacancy.provenance,
    publishedAt: vacancy.publishedAt,
    status: vacancy.status,
  };
}

export function normalizeQuery(query: string | undefined): string | undefined {
  const trimmed = query?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

/** Новые сверху; при равной дате — по идентификатору, чтобы страницы не плыли. */
export function compareNewestFirst(a: UnifiedVacancy, b: UnifiedVacancy): number {
  const byDate = (parseMs(b.publishedAt) ?? 0) - (parseMs(a.publishedAt) ?? 0);
  return byDate !== 0 ? byDate : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function matchesQuery(vacancy: UnifiedVacancy, query: VacancyPoolQuery): boolean {
  if (!isWithin(parseMs(vacancy.publishedAt), query.window)) return false;
  if (query.sourceIds && !query.sourceIds.includes(vacancy.provenance.sourceId)) return false;
  if (query.isRemote !== undefined && vacancy.isRemote !== query.isRemote) return false;
  const needle = normalizeQuery(query.query);
  if (needle !== undefined && !searchTextOf(vacancy).includes(needle)) return false;
  return true;
}

/** Эталонная выдача по списку в памяти; SQLite обязан отвечать так же. */
export function pageOf(all: Iterable<UnifiedVacancy>, query: VacancyPoolQuery): VacancyPoolPage {
  const matched = Array.from(all).filter((vacancy) => matchesQuery(vacancy, query));
  matched.sort(compareNewestFirst);
  return { total: matched.length, items: matched.slice(query.offset, query.offset + query.limit) };
}
