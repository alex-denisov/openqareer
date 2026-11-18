import { useEffect } from 'react';
import { vacancyFitMark } from '../../../vacancies/vacancyFitModel';
import { vacanciesWord } from '../format';
import { useVacancyLinks, type VacancyLinks } from '../vacancyLinks';
import { FilterSheet } from './FilterSheet';
import { HiddenRows } from './HiddenRows';
import { FiltersBar } from './FiltersBar';
import { withoutKind, type FilterKind } from './filterModel';
import {
  CountTitle,
  EmptyByFilters,
  GapStrip,
  LoadErrors,
  LoadingLine,
  MoreFoot,
  SortError,
} from './ListParts';
import { TableBlock } from './TableBlock';
import { TriagePanel } from './TriagePanel';
import { ReviewButton } from './TriageParts';
import type { RowEnv, RowPick } from './VacancyRow';
import type { MatchedVacancyItem } from '../../../coach/cabinetTypes';
import { useHiddenSection, type HiddenSection } from './useHiddenSection';
import { useRowInteractions, type RowInteractions } from './useRowInteractions';
import { usePoolRetry } from './usePoolRetry';
import { useTriage, type Triage } from './useTriage';
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

/** Флажок и причина строки, которую режим «Помочь выбрать» предлагает скрыть. */
function pickOf(triage: Triage, item: MatchedVacancyItem): RowPick | undefined {
  const id = item.cluster.id;
  const row = triage.rowFor(id);
  if (row?.verdict !== 'hide') return undefined;
  return { checked: triage.isPicked(id), reason: row.reasonLabel ?? '', onToggle: () => triage.toggle(id) };
}

function ListTable({
  list,
  rows,
  section,
  env,
  links,
  triage,
}: {
  list: VacancyList;
  rows: RowInteractions;
  section: HiddenSection;
  env: RowEnv;
  links: VacancyLinks;
  triage: Triage;
}) {
  if (list.all.length === 0 && !section.show && !list.server.active) return null;
  const { status, retry } = list.server;
  const hidden = section.show ? (
    <HiddenRows
      hidden={section.hidden}
      env={env}
      openId={rows.openId}
      menuId={section.menuId}
      onToggleOpen={rows.toggleOpen}
      onMenu={section.setMenuId}
      onUnhide={section.unhide}
    />
  ) : undefined;
  return (
    <>
      <TableBlock
        items={list.visible}
        env={env}
        sort={list.sort}
        onSort={list.toggleSort}
        links={links}
        rows={rows}
        rates={list.rates}
        hidden={hidden}
        pickFor={(item) => pickOf(triage, item)}
      />
      {status === 'loading' ? <LoadingLine text="Сортируем подборку…" /> : null}
      {status === 'failed' ? <SortError onRetry={retry} /> : null}
      {status === 'loading' || status === 'failed' ? null : (
        <MoreFoot total={list.more.total} shown={list.more.shown} onMore={list.showMore} />
      )}
    </>
  );
}

/** Строка счётчика: число вакансий слева, «Помочь выбрать» справа. */
function CountBar({ list, hideCount, triage }: { list: VacancyList; hideCount: boolean; triage: Triage }) {
  return (
    <div className="vl-top vl-countbar">
      {hideCount || !list.countKnown ? null : (
        <CountTitle count={list.count} word={vacanciesWord(list.count)} tip />
      )}
      {list.all.length > 0 || triage.active ? (
        <div className="va-lact vl-acts">
          <ReviewButton active={triage.active} onClick={triage.active ? triage.cancel : triage.start} />
        </div>
      ) : null}
    </div>
  );
}

/** Узел s07: подборка вакансий с фильтрами, сортировкой и порциями по 20. */
export function ListScreen() {
  const links = useVacancyLinks();
  const rows = useRowInteractions(links);
  const list = useVacancyList(links, rows.hiddenIds);
  const { pool } = list;
  const section = useHiddenSection(rows, pool.refresh);
  const triage = useTriage(list.all, rows.hideMany);
  // Итог «скрывать нечего» живёт до следующего действия со списком: фильтры, сортировка, скрытие.
  const { clearResult } = triage;
  const listAction = `${JSON.stringify(list.filters)}|${JSON.stringify(list.sort)}|${rows.hiddenIds.size}`;
  useEffect(() => clearResult(), [listAction, clearResult]);
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
      <section className={`col vl vt-wrap${strip ? ' is-v6' : ''}${triage.active ? ' is-triage' : ''}`} aria-labelledby="list-title">
        <CountBar list={list} hideCount={unread} triage={triage} />
        <FiltersBar
          {...filterProps(list, section)}
          openKind={list.openKind}
          shown={list.count}
          onOpenKind={list.setOpenKind}
          onOpenSheet={() => list.setSheetOpen(true)}
          onReset={list.resetFilters}
        />
        <TriagePanel triage={triage} />
        <LoadErrors pool={pool} links={links} poolFailed={pool.failed && !retrying} />
        {waiting ? <LoadingLine /> : null}
        {!unread && list.all.length === 0 && !serverBusy ? <EmptyList list={list} /> : null}
        <ListTable list={list} rows={rows} section={section} env={env} links={links} triage={triage} />
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
