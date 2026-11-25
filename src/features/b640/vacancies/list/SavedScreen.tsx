import { useMemo, useState } from 'react';
import { useCurrencyRates } from '../../../vacancies/useCurrencyRates';
import { useMatchedPool, type MatchedPool } from '../../../vacancies/useMatchedPool';
import { Link } from '../../kit';
import { buildNodePath } from '../../routes';
import { pluralRu } from '../format';
import { isSaved, useVacancyLinks, type VacancyLinks } from '../vacancyLinks';
import { CountTitle, LoadErrors, LoadingLine } from './ListParts';
import { SERVER_SORT, nextSort, sortItems, type SortState } from './sortModel';
import { useRowInteractions } from './useRowInteractions';
import { TableBlock } from './TableBlock';

const SAVED_WORD = (count: number): string =>
  pluralRu(count, 'сохранённая вакансия', 'сохранённые вакансии', 'сохранённых вакансий');

function EmptySaved() {
  return (
    <p className="st-var-line" role="status">
      <span>Сохранённых вакансий нет</span>
      <Link className="btn is-sm" to={buildNodePath('s07')}>
        Перейти в подборку
      </Link>
    </p>
  );
}

/** Подборка читается порциями: пока найдены не все сохранённые, число не называем. */
function isCounting(
  pool: MatchedPool,
  links: VacancyLinks,
  hiddenIds: ReadonlySet<string>,
  found: number,
): boolean {
  if (pool.reading !== true || pool.complete) return false;
  const saved = [...links.byCluster].filter(([id, item]) => isSaved(item) && !hiddenIds.has(id));
  return found < saved.length;
}

/** Узел v06s: та же таблица по вакансиям, у которых карточка в стадии «сохранено». */
export function SavedScreen() {
  const pool = useMatchedPool();
  const links = useVacancyLinks();
  const rates = useCurrencyRates();
  const rows = useRowInteractions(links);
  const [sortState, setSortState] = useState<SortState | null>(null);
  const items = useMemo(
    () =>
      sortItems(
        pool.matched.filter(
          (item) =>
            isSaved(links.byCluster.get(item.cluster.id)) && !rows.hiddenIds.has(item.cluster.id),
        ),
        sortState,
        rates,
      ),
    [pool.matched, links.byCluster, rows.hiddenIds, sortState, rates],
  );
  const waiting = items.length === 0 && (pool.loading || pool.reading === true || links.loading);
  const counting = isCounting(pool, links, rows.hiddenIds, items.length);
  const env = { currency: 'RUB' as const, rates, noRole: false };
  const empty = !waiting && items.length === 0 && !pool.failed && !links.failed;
  return (
    <div className="page" data-b640-node="v06s" data-b640-section="vacancies">
      {empty ? <EmptySaved /> : null}
      <section className="col vl vt-wrap is-v6" {...(counting ? { 'aria-label': 'Сохранённые вакансии' } : { 'aria-labelledby': 'list-title' })}>
        {items.length > 0 ? (
          <div className="vl-top">
            {counting ? <LoadingLine /> : <CountTitle count={items.length} word={SAVED_WORD(items.length)} />}
          </div>
        ) : null}
        <LoadErrors pool={pool} links={links} poolFailed={pool.failed} />
        {waiting ? <LoadingLine /> : null}
        {items.length > 0 ? (
          <TableBlock
            items={items}
            env={env}
            sort={sortState ?? SERVER_SORT}
            onSort={(key) => setSortState((current) => nextSort(current ?? SERVER_SORT, key))}
            links={links}
            rows={rows}
            rates={rates}
          />
        ) : null}
      </section>
    </div>
  );
}
