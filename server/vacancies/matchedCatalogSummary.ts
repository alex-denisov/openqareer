import type { MatchedVacancyCatalogSummary } from '../../shared/matchedVacancyFacets';

/** Размер каталога (активные кластеры) и конец последнего сведения (B485). */
export interface CatalogTotals {
  readonly clusters: number;
  readonly updatedAt?: string;
}

/** Итоги пересчитывает обслуживание после волны, не чаще раза в 15 минут. */
export const CATALOG_TOTALS_REFRESH_MS = 15 * 60_000;

/** 01.11: the header counts one set — the filtered selection and its rows with a percent. */
export interface SelectionFitTally {
  readonly selectionTotal: number;
  readonly fitCounted: number;
}

export function matchedCatalogSummary(
  totals: CatalogTotals | undefined,
  roleLevelMatches: number,
  selection?: SelectionFitTally,
): MatchedVacancyCatalogSummary | undefined {
  if (!totals || totals.clusters <= 0) return undefined;
  return {
    roleLevelMatches,
    ...(selection ?? {}),
    catalogTotal: totals.clusters,
    ...(totals.updatedAt ? { observedAt: totals.updatedAt } : {}),
  };
}
