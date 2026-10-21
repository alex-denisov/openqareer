import type { MatchedVacancyCatalogSummary } from '../../shared/matchedVacancyFacets';

/** Размер сведённого каталога и время его последней записи (B485). */
export interface CatalogTotals {
  readonly clusters: number;
  readonly updatedAt?: string;
}

/** Чаще раза в десять минут каталог на HTTP-пути не считается. */
export const CATALOG_TOTALS_TTL_MS = 10 * 60_000;

/**
 * Один индексный запрос раз в TTL на процесс, а не на каждый запрос подборки:
 * полное чтение пула на HTTP запрещено, а счёт строк — нет, но и его не
 * повторяем. Ошибка чтения — сводки нет, клиент пишет «неизвестно».
 */
export class CatalogTotalsCache {
  private cached?: { readonly at: number; readonly totals: CatalogTotals };

  constructor(
    private readonly readTotals: () => CatalogTotals,
    private readonly now: () => number = Date.now,
  ) {}

  read(): CatalogTotals | undefined {
    const at = this.now();
    if (this.cached && at - this.cached.at < CATALOG_TOTALS_TTL_MS) return this.cached.totals;
    try {
      this.cached = { at, totals: this.readTotals() };
      return this.cached.totals;
    } catch {
      return undefined;
    }
  }
}

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
