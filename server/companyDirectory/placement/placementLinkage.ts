import { nameKey } from '../freehire/freehireImport';
import { sourceKind, type SourceKind } from '../../vacancies/poolLiveness';

/**
 * B643 — связь вакансии с компанией справочника. Компания — источник,
 * размещение (сайт, доска ATS, LinkedIn, агрегатор) — отдельно. Модуль чистый:
 * его читают и замер B643-1, и будущий догон связей.
 */

export interface DirectoryRow {
  readonly companyKey: string;
  readonly companyName: string;
  readonly websiteUrl: string | null;
  readonly atsProvider: string | null;
  readonly atsSlug: string | null;
}

export interface LinkageIndex {
  readonly byKey: { has(key: string): boolean };
  readonly byBoard: { get(key: string): string | undefined };
  /** nameKey → компания; `null` — имя носят несколько компаний. */
  readonly byName: ReadonlyMap<string, string | null>;
}

export type EmployerLink = { readonly companyKey: string; readonly how: 'ats_board' | 'company_key' };
export type NameLink =
  | { readonly status: 'linked'; readonly companyKey: string }
  | { readonly status: 'ambiguous' }
  | { readonly status: 'unlinked' };

export type PlacementType = 'employer_site' | 'ats' | 'linkedin' | 'aggregator';
export type Coverage = 'site' | 'ats' | 'linkedin' | 'aggregator_only' | 'none';

const boardKey = (provider: string, slug: string): string => `${provider}:${slug.toLowerCase()}`;

export function buildLinkageIndex(rows: readonly DirectoryRow[]): LinkageIndex {
  const byKey = new Set<string>();
  const byBoard = new Map<string, string>();
  const byName = new Map<string, string | null>();
  for (const row of rows) {
    byKey.add(row.companyKey);
    if (row.atsProvider && row.atsSlug) byBoard.set(boardKey(row.atsProvider, row.atsSlug), row.companyKey);
    const name = nameKey(row.companyName);
    if (!name) continue;
    const seen = byName.get(name);
    byName.set(name, seen === undefined || seen === row.companyKey ? row.companyKey : null);
  }
  return { byKey, byBoard, byName };
}

function boardSlugOf(sourceId: string, provider: string): string | undefined {
  for (const prefix of [`ats-${provider}-`, `src-fh-${provider}-`]) {
    if (sourceId.startsWith(prefix)) return sourceId.slice(prefix.length);
  }
  return undefined;
}

const COMPANY_KEY_PREFIXES = ['src-company-site-', 'src-company-li-', 'src-fh-'];

/** Компания доски работодателя по самому `source_id`; агрегатор — `null`. */
export function linkEmployerSource(sourceId: string, index: LinkageIndex): EmployerLink | null {
  const kind = sourceKind(sourceId);
  if (kind.kind === 'aggregator' || kind.kind === 'hh') return null;
  if (kind.kind === 'ats') {
    const slug = boardSlugOf(sourceId, kind.provider);
    const hit = slug ? index.byBoard.get(boardKey(kind.provider, slug)) : undefined;
    if (hit) return { companyKey: hit, how: 'ats_board' };
    if (slug && index.byKey.has(slug.toLowerCase())) return { companyKey: slug.toLowerCase(), how: 'company_key' };
    return null;
  }
  for (const prefix of COMPANY_KEY_PREFIXES) {
    if (!sourceId.startsWith(prefix)) continue;
    const key = sourceId.slice(prefix.length).toLowerCase();
    if (index.byKey.has(key)) return { companyKey: key, how: 'company_key' };
  }
  return null;
}

/** Точное совпадение nameKey; имя нескольких компаний остаётся без связи. */
export function linkByEmployerName(name: string | null | undefined, index: LinkageIndex): NameLink {
  const key = nameKey(name ?? '');
  if (!key) return { status: 'unlinked' };
  const hit = index.byName.get(key);
  if (hit === undefined) return { status: 'unlinked' };
  return hit === null ? { status: 'ambiguous' } : { status: 'linked', companyKey: hit };
}

export function placementTypeOf(kind: SourceKind): PlacementType {
  if (kind.kind === 'hh') return 'aggregator';
  return kind.kind;
}

const COVERAGE_ORDER: readonly [PlacementType, Coverage][] = [
  ['employer_site', 'site'],
  ['ats', 'ats'],
  ['linkedin', 'linkedin'],
  ['aggregator', 'aggregator_only'],
];

/** Лучшее размещение компании: сайт → ATS → LinkedIn → агрегатор. */
export function classifyCoverage(types: ReadonlySet<PlacementType>): Coverage {
  return COVERAGE_ORDER.find(([type]) => types.has(type))?.[1] ?? 'none';
}
