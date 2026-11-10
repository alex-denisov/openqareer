import type { UnifiedVacancy } from '../domain/unifiedVacancy';

function parseMs(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * B642 — вакансия живёт в пуле, пока она открыта, а не 30 дней от публикации.
 *
 * Открытость подтверждает только полное чтение доски самого работодателя: ATS
 * или карьерный сайт отдают всю выдачу, и отсутствие в ней значит «снято»
 * (такая запись удаляется сразу заменой среза). Агрегаторы и частичные чтения
 * этого не знают — для них остаётся срок 30 дней от публикации.
 */

/** Карьерные сайты работодателей с полным чтением выдачи (не агрегаторы). */
const EMPLOYER_SITE_IDS: ReadonlySet<string> = new Set([
  'src-amazon-jobs',
  'src-apple-jobs',
  'src-netflix',
  'src-microsoft-careers',
  'src-qualcomm-careers',
]);

/** Сколько дней невиденная запись подтверждающего источника держится в пуле. */
export const NOT_SEEN_PRUNE_DAYS = 7;

export function confirmsLiveness(sourceId: string): boolean {
  return sourceId.startsWith('ats-') || EMPLOYER_SITE_IDS.has(sourceId);
}

/**
 * Дата, которую меряет окно свежести. У подтверждающего источника — последнее
 * чтение, где запись была видна; у остальных — дата публикации. Сама дата
 * публикации в записи не меняется.
 */
export function freshnessAnchorMs(vacancy: UnifiedVacancy): number | undefined {
  const published = parseMs(vacancy.publishedAt);
  if (!confirmsLiveness(vacancy.provenance.sourceId)) return published;
  const seen = parseMs(vacancy.provenance.observedAt);
  if (seen === undefined) return published;
  return published === undefined ? seen : Math.max(seen, published);
}
