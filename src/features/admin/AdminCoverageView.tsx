import { ArrowsClockwise, Clock, LockSimple, Warning, XCircle } from '@phosphor-icons/react';
import type { CoverageCompany, CoverageFilter, CoverageTotals } from './coverageApi';
import { agoLabel, computedAtLabel, isStale } from './coverageModel';
import { CoverageClassTable, CoverageLead } from './CoverageSummary';
import { CoverageCompanyList, CoverageFilterChips } from './CoverageCompanyList';

/** B643-11: экран «Покрытие компаний» по макету, принятому владельцем 12.11. */
export type CoverageTotalsState =
  | { status: 'loading' }
  | { status: 'ready'; totals: CoverageTotals }
  | { status: 'error'; message: string }
  | { status: 'forbidden' };

export interface CoverageListState {
  readonly filter: CoverageFilter;
  readonly items: readonly CoverageCompany[];
  readonly nextCursor: string | null;
  readonly status: 'loading' | 'ready' | 'error';
}

export interface AdminCoverageViewProps {
  totals: CoverageTotalsState;
  list: CoverageListState;
  now: number;
  onRefresh: () => void;
  onFilter: (filter: CoverageFilter) => void;
  onMore: () => void;
  onRetryList: () => void;
}

function Freshness({ totals, now }: { totals: CoverageTotalsState; now: number }) {
  if (totals.status !== 'ready') return null;
  const { computedAt } = totals.totals;
  const stale = isStale(computedAt, now);
  const title = stale
    ? `Итоги старше 10 минут: пересчёт не прошёл. Расчёт: ${computedAtLabel(computedAt)}`
    : `Итоги пересчитываются раз в 10 минут. Расчёт: ${computedAtLabel(computedAt)}`;
  const Icon = stale ? Warning : Clock;
  return (
    <span className={`admin-coverage-fresh${stale ? ' is-stale' : ''}`} title={title}>
      <Icon size={16} aria-hidden="true" /> Обновлено {agoLabel(computedAt, now)}
    </span>
  );
}

function Header({ totals, now, onRefresh }: Pick<AdminCoverageViewProps, 'totals' | 'now' | 'onRefresh'>) {
  return (
    <div className="admin-coverage-head">
      <div>
        <p className="admin-eyebrow">Администрирование / сбор</p>
        <h1 id="admin-coverage-title">Покрытие компаний</h1>
        <p className="admin-note">Где компании публикуют вакансии и сколько объявлений в пуле.</p>
      </div>
      {totals.status === 'forbidden' ? null : (
        <div className="admin-coverage-head__actions">
          <Freshness totals={totals} now={now} />
          <button type="button" className="admin-btn is-secondary" onClick={onRefresh} disabled={totals.status === 'loading'}>
            <ArrowsClockwise size={16} aria-hidden="true" /> Обновить
          </button>
        </div>
      )}
    </div>
  );
}

function Loading() {
  return (
    <section className="admin-coverage-panel admin-coverage-loading" aria-busy="true" aria-label="Итоги и список считаются">
      <div className="admin-coverage-skel is-big" />
      <div className="admin-coverage-skel" />
      <div className="admin-coverage-skel is-short" />
    </section>
  );
}

function TotalsError({ onRefresh }: { onRefresh: () => void }) {
  return (
    <section className="admin-coverage-panel admin-coverage-state">
      <div className="admin-coverage-alert is-error" role="alert">
        <XCircle size={16} aria-hidden="true" />
        <div>Не удалось получить итоги покрытия. Проверьте соединение и повторите.</div>
      </div>
      <button type="button" className="admin-btn is-secondary" onClick={onRefresh}>
        <ArrowsClockwise size={16} aria-hidden="true" /> Повторить
      </button>
    </section>
  );
}

function NoAccess() {
  return (
    <section className="admin-coverage-panel admin-coverage-state">
      <div className="admin-coverage-alert" role="status">
        <LockSimple size={16} aria-hidden="true" />
        <div>Экран доступен администраторам с правом управлять пулом вакансий.</div>
      </div>
    </section>
  );
}

function Body(props: AdminCoverageViewProps & { totals: { status: 'ready'; totals: CoverageTotals } }) {
  const { totals, list, now, onFilter, onMore, onRetryList } = props;
  const filter = list.filter;
  const total = filter === 'all' ? totals.totals.totalCompanies : totals.totals.classes[filter].companies;
  return (
    <>
      <CoverageLead totals={totals.totals} />
      <CoverageClassTable totals={totals.totals} filter={filter} onFilter={onFilter} />
      <div className="admin-coverage-section-title">
        <h2>Компании</h2>
        <span className="admin-note">По числу объявлений в пуле, сначала крупные</span>
      </div>
      <CoverageFilterChips filter={filter} onFilter={onFilter} />
      <CoverageCompanyList
        list={list}
        total={total}
        now={now}
        onMore={onMore}
        onRetryList={onRetryList}
        onShowAll={() => onFilter('all')}
      />
    </>
  );
}

export function AdminCoverageView(props: AdminCoverageViewProps) {
  const { totals } = props;
  return (
    <section className="admin-coverage" aria-labelledby="admin-coverage-title">
      <Header totals={totals} now={props.now} onRefresh={props.onRefresh} />
      {totals.status === 'loading' ? <Loading /> : null}
      {totals.status === 'error' ? <TotalsError onRefresh={props.onRefresh} /> : null}
      {totals.status === 'forbidden' ? <NoAccess /> : null}
      {totals.status === 'ready' ? <Body {...props} totals={totals} /> : null}
    </section>
  );
}
