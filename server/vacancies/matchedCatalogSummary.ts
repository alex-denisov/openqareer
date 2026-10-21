import type { MatchedVacancyCatalogSummary } from '../../shared/matchedVacancyFacets';

/** Размер каталога (активные кластеры) и конец последнего сведения (B485). */
export interface CatalogTotals {
  readonly clusters: number;
  readonly updatedAt?: string;
}

/** Итоги пересчитывает обслуживание после волны, не чаще раза в 15 минут. */
export const CATALOG_TOTALS_REFRESH_MS = 15 * 60_000;

export function matchedCatalogSummary(
  totals: CatalogTotals | undefined,
  roleLevelMatches: number,
): MatchedVacancyCatalogSummary | undefined {
  if (!totals || totals.clusters <= 0) return undefined;
  return {
    roleLevelMatches,
    catalogTotal: totals.clusters,
    ...(totals.updatedAt ? { observedAt: totals.updatedAt } : {}),
  };
}
