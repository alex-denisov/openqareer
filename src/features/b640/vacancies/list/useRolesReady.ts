import { useRef } from 'react';
import type { MatchedPool } from '../../../vacancies/useMatchedPool';
import { defaultRoles } from './defaultRoles';
import { EMPTY_FILTERS, type ListFilters } from './filterModel';

/**
 * Роли по умолчанию список ставит сам после первого чтения. До этого его выборка шире, чем станет:
 * по ссылке на «Помочь выбрать» разбор считал все 906 вакансий при 621 в шапке. Готово — навсегда:
 * снятые потом роли — выбор кандидата.
 */
export function useRolesReady(
  filters: ListFilters,
  pool: Pick<MatchedPool, 'initialFilters' | 'campaign'>,
): boolean {
  const ready = useRef(false);
  const { initialFilters, campaign } = pool;
  const known = Boolean(initialFilters || campaign);
  ready.current ||=
    filters !== EMPTY_FILTERS ||
    (known && defaultRoles(initialFilters?.roles, campaign?.roles).length === 0);
  return ready.current;
}
