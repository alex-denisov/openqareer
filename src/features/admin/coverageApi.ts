import { apiFetch, readData } from '../coach/apiClient';

/** B643-11: ответы GET /api/v1/admin/directory/coverage{,/companies} (B643-10). */
export const COVERAGE_CLASS_ORDER = ['ats', 'site', 'aggregator_only', 'linkedin_only', 'none'] as const;
export type CoverageClass = (typeof COVERAGE_CLASS_ORDER)[number];
export type CoverageFilter = CoverageClass | 'all';

export const COVERAGE_PAGE_SIZE = 50;

export interface CoverageTotals {
  readonly totalCompanies: number;
  readonly classes: Readonly<Record<CoverageClass, { companies: number; vacancies: number }>>;
  readonly computedAt: number;
}

export interface CoveragePlacement {
  readonly type: string;
  readonly id: string;
  readonly health: string | null;
  readonly lastCheckedAt: number | null;
  readonly domain?: string | null;
}

export interface CoverageCompany {
  readonly companyKey: string;
  readonly name: string;
  readonly class: CoverageClass;
  readonly placements: readonly CoveragePlacement[];
  readonly vacancies: number;
}

export interface CoveragePage {
  readonly items: readonly CoverageCompany[];
  readonly nextCursor: string | null;
}

export async function getCoverageTotals(signal?: AbortSignal): Promise<CoverageTotals> {
  const response = await apiFetch('/api/v1/admin/directory/coverage', signal ? { signal } : {});
  return readData<CoverageTotals>(response);
}

export async function getCoverageCompanies(
  input: { filter: CoverageFilter; cursor: string | null },
  signal?: AbortSignal,
): Promise<CoveragePage> {
  const params = new URLSearchParams({ limit: String(COVERAGE_PAGE_SIZE) });
  if (input.filter !== 'all') params.set('class', input.filter);
  if (input.cursor) params.set('cursor', input.cursor);
  const response = await apiFetch(
    `/api/v1/admin/directory/coverage/companies?${params.toString()}`,
    signal ? { signal } : {},
  );
  return readData<CoveragePage>(response);
}
