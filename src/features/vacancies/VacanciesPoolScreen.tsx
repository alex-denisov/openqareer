import { VacanciesScreen, type VacanciesScreenProps } from './VacanciesScreen';
import { useMatchedPool, type MatchedPool } from './useMatchedPool';

/** Фильтры страницы не меняют общий пул кабинета и сбрасываются при уходе. */
export function VacanciesPoolScreen({
  pool,
  ...props
}: {
  readonly pool: MatchedPool;
} & Omit<VacanciesScreenProps, 'matched' | 'total' | 'initialFilters' | 'serverSort'>) {
  const selection = useMatchedPool(pool);
  return (
    <VacanciesScreen
      {...props}
      matched={selection.matched}
      // While pages are still being read the server's pool size is the denominator, not 0.
      total={selection.total || selection.poolTotal}
      poolComplete={selection.complete}
      facets={selection.facets}
      initialFilters={selection.initialFilters}
      serverSort={selection.sort}
      campaign={selection.campaign}
      candidateLevel={selection.candidateLevel}
      loading={selection.loading}
      failed={selection.failed}
      failureSourceLabel={selection.failureSourceLabel}
      onFiltersChange={selection.setFilters}
      onRetry={selection.refresh}
    />
  );
}
