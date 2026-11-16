import { vacancyFitMark } from '../../../vacancies/vacancyFitModel';
import { vacanciesWord } from '../format';
import { useVacancyLinks } from '../vacancyLinks';
import { FilterSheet } from './FilterSheet';
import { FiltersBar } from './FiltersBar';
import { withoutKind, type FilterKind } from './filterModel';
import { CountTitle, EmptyByFilters, GapStrip, LoadErrors, LoadingLine, MoreFoot } from './ListParts';
import { TableBlock } from './TableBlock';
import { useRowInteractions } from './useRowInteractions';
import { useVacancyList, type VacancyList } from './useVacancyList';

/** Профиль пуст: у каждой загруженной вакансии процента нет из-за отсутствия опыта. */
function profileIsEmpty(list: VacancyList): boolean {
  const items = list.pool.matched;
  return (
    items.length > 0 &&
    items.every((item) => {
      const mark = vacancyFitMark(item.explanation.fitView);
      return mark.kind === 'none' && mark.caption === 'нет профиля';
    })
  );
}

function filterProps(list: VacancyList) {
  return {
    filters: list.filters,
    options: list.options,
    currency: list.currency,
    onChange: list.setFilters,
    onCurrency: list.setCurrency,
  };
}

function EmptyList({ list }: { list: VacancyList }) {
  if (list.blockers.length === 0) {
    return (
      <p className="st-var-line" role="status">
        <span>Подходящих вакансий пока нет</span>
      </p>
    );
  }
  return (
    <EmptyByFilters
      blockers={list.blockers}
      onRemove={(kind) => list.setFilters(withoutKind(list.filters, kind as FilterKind | 'reloc'))}
      onReset={list.resetFilters}
    />
  );
}

/** Узел s07: подборка вакансий с фильтрами, сортировкой и порциями по 20. */
export function ListScreen() {
  const links = useVacancyLinks();
  const rows = useRowInteractions(links);
  const list = useVacancyList(links, rows.hiddenIds);
  const { pool } = list;
  const env = { currency: list.currency, rates: list.rates, noRole: list.noRole };
  const waiting = pool.loading && pool.matched.length === 0;
  const strip = list.noRole ? 'role' : profileIsEmpty(list) ? 'profile' : null;
  return (
    <div className="page" data-b640-node="s07">
      {strip ? <GapStrip kind={strip} /> : null}
      <section className={`col vl vt-wrap${strip ? ' is-v6' : ''}`} aria-labelledby="list-title">
        <div className="vl-top vl-countbar">
          <CountTitle count={list.count} word={vacanciesWord(list.count)} tip />
        </div>
        <FiltersBar
          {...filterProps(list)}
          openKind={list.openKind}
          shown={list.count}
          onOpenKind={list.setOpenKind}
          onOpenSheet={() => list.setSheetOpen(true)}
          onReset={list.resetFilters}
        />
        <LoadErrors pool={pool} links={links} />
        {waiting ? <LoadingLine /> : null}
        {!waiting && list.all.length === 0 && !pool.failed ? <EmptyList list={list} /> : null}
        {list.all.length > 0 ? (
          <>
            <TableBlock items={list.visible} env={env} sort={list.sort} onSort={list.toggleSort} links={links} rows={rows} rates={list.rates} />
            <MoreFoot total={list.all.length} shown={list.visible.length} onMore={list.showMore} />
          </>
        ) : null}
      </section>
      <FilterSheet
        {...filterProps(list)}
        open={list.sheetOpen}
        shown={list.count}
        sort={list.sort}
        onSort={list.toggleSort}
        onClose={() => list.setSheetOpen(false)}
        onReset={list.resetFilters}
      />
    </div>
  );
}
