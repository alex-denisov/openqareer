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

/**
 * freehire — репозиторий адаптеров, а не источник: под `src-fh-` лежат доски
 * ATS работодателей, сайты компаний и две площадки-агрегатора.
 */
const FREEHIRE_PREFIX = 'src-fh-';
const FREEHIRE_AGGREGATORS: ReadonlySet<string> = new Set(['getmatch', 'habr-career']);
const ATS_PROVIDERS: readonly string[] = [
  'greenhouse',
  'lever',
  'ashby',
  'workable',
  'recruitee',
  'smartrecruiters',
  'breezy',
  'pinpoint',
  'personio',
  'bamboohr',
  'teamtailor',
  'workday',
  'icims',
  'jobvite',
  'oracle',
  'paylocity',
  'join',
  'paycom',
];

export type SourceKind =
  | { readonly kind: 'ats'; readonly provider: string }
  | { readonly kind: 'employer_site' | 'aggregator' | 'hh' | 'linkedin' };

function atsProviderOf(rest: string): string | undefined {
  return ATS_PROVIDERS.find((provider) => rest.startsWith(`${provider}-`));
}

/** Тип настоящего источника: доска ATS, сайт работодателя, агрегатор, hh, LinkedIn. */
export function sourceKind(sourceId: string): SourceKind {
  if (sourceId.startsWith('ats-')) {
    return { kind: 'ats', provider: atsProviderOf(sourceId.slice(4)) ?? 'other' };
  }
  if (sourceId.startsWith(FREEHIRE_PREFIX)) {
    const rest = sourceId.slice(FREEHIRE_PREFIX.length);
    const provider = atsProviderOf(rest);
    if (provider) return { kind: 'ats', provider };
    return { kind: FREEHIRE_AGGREGATORS.has(rest) ? 'aggregator' : 'employer_site' };
  }
  if (EMPLOYER_SITE_IDS.has(sourceId) || sourceId.startsWith('src-company-site-')) {
    return { kind: 'employer_site' };
  }
  if (sourceId === 'hh' || sourceId.startsWith('src-hh-')) return { kind: 'hh' };
  if (sourceId.includes('linkedin') || sourceId.startsWith('src-company-li-')) {
    return { kind: 'linkedin' };
  }
  return { kind: 'aggregator' };
}

/** Сколько дней невиденная запись подтверждающего источника держится в пуле. */
export const NOT_SEEN_PRUNE_DAYS = 7;

export function confirmsLiveness(sourceId: string): boolean {
  const { kind } = sourceKind(sourceId);
  return kind === 'ats' || kind === 'employer_site';
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

/** Первое чтение записи; последнее лежит в `observed_ms`. */
export const VACANCY_POOL_INDEX_FIRST_SEEN_COLUMN = `
ALTER TABLE vacancy_pool_index ADD COLUMN first_seen_ms INTEGER;
`;
