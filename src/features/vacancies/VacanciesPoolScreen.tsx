import { VacanciesScreen, type VacanciesScreenProps } from './VacanciesScreen';
import { useMatchedPool, type MatchedPool } from './useMatchedPool';

/** Фильтры страницы не меняют общий пул кабинета и сбрасываются при уходе. */
export function VacanciesPoolScreen({ pool, ...props }: {
  readonly pool: MatchedPool;
} & Omit<VacanciesScreenProps, 'matched' | 'total'>) {
  const selection = useMatchedPool(pool);
  return <VacanciesScreen {...props}
    matched={selection.matched} total={selection.total}
    facets={selection.facets} campaign={selection.campaign}
    candidateLevel={selection.candidateLevel} loading={selection.loading}
    failed={selection.failed} failureSourceLabel={selection.failureSourceLabel}
    onFiltersChange={selection.setFilters} onRetry={selection.refresh} />;
}
