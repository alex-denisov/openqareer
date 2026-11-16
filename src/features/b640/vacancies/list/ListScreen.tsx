import { vacancyFitMark } from '../../../vacancies/vacancyFitModel';
import { vacanciesWord } from '../format';
import { useVacancyLinks } from '../vacancyLinks';
import { FilterSheet } from './FilterSheet';
import { HiddenRows } from './HiddenRows';
import { FiltersBar } from './FiltersBar';
import { withoutKind, type FilterKind } from './filterModel';
import { CountTitle, EmptyByFilters, GapStrip, LoadErrors, LoadingLine, MoreFoot, SortError } from './ListParts';
import { TableBlock } from './TableBlock';
import { useHiddenSection, type HiddenSection } from './useHiddenSection';
import { useRowInteractions } from './useRowInteractions';
import { usePoolRetry } from './usePoolRetry';
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

function filterProps(list: VacancyList, section: HiddenSection) {
  return {
    showHidden: section.show,
    onShowHidden: section.setShow,
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
  const section = useHiddenSection(rows, pool.refresh);
  const env = { currency: list.currency, rates: list.rates, noRole: list.noRole };
  const retrying = usePoolRetry(pool);
  const serverBusy = list.server.active && list.server.status !== 'ready';
  const empty = pool.matched.length === 0;
  const waiting = empty && (pool.loading || retrying);
  // Числа и список появляются с первой прочитанной порцией: «0 вакансий» на время чтения не пишем.
  const unread = empty && (pool.loading || retrying || pool.failed);
  const strip = list.noRole ? 'role' : profileIsEmpty(list) ? 'profile' : null;
  return (
    <div className="page" data-b640-node="s07" data-b640-section="vacancies">
      {strip ? <GapStrip kind={strip} /> : null}
      <section className={`col vl vt-wrap${strip ? ' is-v6' : ''}`} aria-labelledby="list-title">
        <div className="vl-top vl-countbar">
          {unread ? null : <CountTitle count={list.count} word={vacanciesWord(list.count)} tip />}
        </div>
        <FiltersBar
          {...filterProps(list, section)}
          openKind={list.openKind}
          shown={list.count}
          onOpenKind={list.setOpenKind}
          onOpenSheet={() => list.setSheetOpen(true)}
          onReset={list.resetFilters}
        />
        <LoadErrors pool={pool} links={links} poolFailed={pool.failed && !retrying} />
        {waiting ? <LoadingLine /> : null}
        {!unread && list.all.length === 0 && !serverBusy ? <EmptyList list={list} /> : null}
        {list.all.length > 0 || section.show || list.server.active ? (
          <>
            <TableBlock
              items={list.visible}
              env={env}
              sort={list.sort}
              onSort={list.toggleSort}
              links={links}
              rows={rows}
              rates={list.rates}
              hidden={section.show ? <HiddenRows hidden={section.hidden} env={env} openId={rows.openId} menuId={section.menuId} onToggleOpen={rows.toggleOpen} onMenu={section.setMenuId} onUnhide={section.unhide} /> : undefined}
            />
            {list.server.status === 'loading' ? <LoadingLine text="Сортируем подборку…" /> : null}
            {list.server.status === 'failed' ? <SortError onRetry={list.server.retry} /> : null}
            {list.server.status === 'loading' || list.server.status === 'failed' ? null : <MoreFoot total={list.more.total} shown={list.more.shown} onMore={list.showMore} />}
          </>
        ) : null}
      </section>
      <FilterSheet
        {...filterProps(list, section)}
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
