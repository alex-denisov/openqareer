import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { htmlToFeedText } from '../connectors/feedText';

/**
 * Чтение одной JSON-записи вакансии: сборка карточки и разбор полей, общие для
 * всех JSON-площадок. Выделено из `jsonSourceAdapters.ts` в B202, когда те же
 * правила понадобились семейству ATS-досок: правило «нечитаемый ответ падает» и
 * правило «непрочитанная дата — не сегодня» обязаны быть одни на всех, а не
 * скопированы во второй файл.
 */
export interface JsonAdapterContext {
  readonly observedAt: string;
  /**
   * Имя источника из реестра. Часть площадок (Lever, Ashby) не публикует
   * работодателя в записи вовсе — тогда его называет реестр, а не догадка.
   */
  readonly sourceName?: string;
}

export type JsonRecord = Record<string, unknown>;

export const UNREADABLE = 'vacancy_source_payload_unreadable';

export function buildJsonVacancy(input: {
  sourceId: string;
  context: JsonAdapterContext;
  externalId: string;
  title: string;
  company: string;
  location?: string;
  isRemote: boolean;
  description: string;
  skills: string[];
  employmentType?: string;
  experienceLevel?: string;
  salary?: UnifiedVacancy['salary'];
  url: string;
  publishedAt: string;
}): UnifiedVacancy {
  const id = `${input.sourceId}:${input.externalId || input.url}`;
  return {
    id,
    fingerprint: id,
    title: htmlToFeedText(input.title),
    company: htmlToFeedText(input.company),
    location: input.location,
    isRemote: input.isRemote,
    salary: input.salary,
    // Boards publish their description as HTML — some of it escaped once more
    // on the way out. Left as it was, the markup reached the candidate and fed
    // the skill extractor and the matcher (B164 prod walk).
    description: htmlToFeedText(input.description),
    requiredSkills: input.skills,
    employmentType: input.employmentType,
    experienceLevel: input.experienceLevel,
    url: input.url,
    provenance: {
      sourceType: 'json_api',
      sourceId: input.sourceId,
      sourceName: input.context.sourceName,
      sourceUrl: input.url,
      externalId: input.externalId || undefined,
      observedAt: input.context.observedAt,
    },
    publishedAt: input.publishedAt,
    status: 'active',
  };
}

/** A record without a title, a company or a link cannot be shown or opened. */
export function isUsableVacancy(vacancy: UnifiedVacancy): boolean {
  return (
    vacancy.title.trim().length > 0 &&
    vacancy.company.trim().length > 0 &&
    vacancy.url.trim().length > 0
  );
}

export function listOf(payload: unknown, select: (value: unknown) => unknown[] | null): unknown[] {
  const items = select(payload);
  if (!items) throw new Error(UNREADABLE);
  return items;
}

export function asArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' ? (value as JsonRecord) : {};
}

export function text(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return '';
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map(text).filter((item) => item.length > 0) : [];
}

export function firstOf(value: unknown): string | undefined {
  const list = stringList(value);
  return list[0];
}

/**
 * An unreadable date is not today. Falling back to `now` is what made a
 * long-dead posting look fresh, so an unparseable value keeps the epoch and is
 * filtered out by the freshness window instead.
 */
export const UNKNOWN_PUBLISHED_AT = new Date(0).toISOString();

export function fromEpochSeconds(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return UNKNOWN_PUBLISHED_AT;
  return new Date(value * 1000).toISOString();
}

export function fromEpochMilliseconds(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return UNKNOWN_PUBLISHED_AT;
  return new Date(value).toISOString();
}

export function fromIso(value: unknown): string {
  const parsed = Date.parse(text(value));
  return Number.isNaN(parsed) ? UNKNOWN_PUBLISHED_AT : new Date(parsed).toISOString();
}

/** `2026-08-27 09:00:00` and `2026-08-14` are both dates these boards return. */
export function fromLooseDate(value: unknown): string {
  // `2026-07-31 22:26:40 UTC` — форма Recruitee; часовой пояс словами Date.parse
  // не читает, а невычитанная дата уводит живую вакансию в отсев по свежести.
  const raw = text(value).trim().replace(/\s+UTC$/i, '');
  if (!raw) return UNKNOWN_PUBLISHED_AT;
  const parsed = Date.parse(raw.includes(' ') ? raw.replace(' ', 'T') + 'Z' : raw);
  return Number.isNaN(parsed) ? UNKNOWN_PUBLISHED_AT : new Date(parsed).toISOString();
}

/** `'75000'` и `75000` — обе формы приходят от живых площадок. */
export function numeric(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
