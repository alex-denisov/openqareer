import { ArrowsClockwise, Check, CheckCircle, MinusCircle, Warning, XCircle } from '@phosphor-icons/react';
import { pluralRu } from '../../../shared/pluralRu';
import {
  COVERAGE_CLASS_ORDER,
  COVERAGE_PAGE_SIZE,
  type CoverageCompany,
  type CoverageFilter,
  type CoveragePlacement,
} from './coverageApi';
import {
  COVERAGE_CLASS_LABELS,
  agoLabel,
  formatCount,
  healthView,
  placementName,
  type HealthTone,
} from './coverageModel';
import type { CoverageListState } from './AdminCoverageView';

const HEALTH_ICON: Readonly<Record<HealthTone, typeof CheckCircle>> = {
  ok: CheckCircle,
  error: XCircle,
  warn: Warning,
  none: MinusCircle,
};

const COMPANY_FORMS: [string, string, string] = ['компания', 'компании', 'компаний'];

function PlacementChip({ placement, now }: { placement: CoveragePlacement; now: number }) {
  const health = healthView(placement.health);
  const Icon = HEALTH_ICON[health.tone];
  const when = placement.health !== null && placement.lastCheckedAt ? ` · ${agoLabel(placement.lastCheckedAt, now)}` : '';
  return (
    <span className={`admin-coverage-place is-${health.tone}`}>
      <b>{placementName(placement)}</b>
      <span className="admin-coverage-place__state">
        <Icon size={14} aria-hidden="true" />
        {`${health.label}${when}`}
      </span>
    </span>
  );
}

function CompanyRow({ company, now }: { company: CoverageCompany; now: number }) {
  return (
    <div className="admin-coverage-row" role="row">
      <span className="admin-coverage-row__name" role="cell">
        <strong>{company.name}</strong>
        <code>{company.companyKey}</code>
      </span>
      <span className="admin-coverage-row__class" role="cell">
        <i className={`admin-coverage-swatch admin-coverage-c-${company.class}`} />
        {COVERAGE_CLASS_LABELS[company.class]}
      </span>
      <span className="admin-coverage-places" role="cell">
        {company.placements.length > 0 ? (
          company.placements.map((placement) => (
            <PlacementChip key={placement.id} placement={placement} now={now} />
          ))
        ) : (
          <span className="admin-coverage-no-place">
            {company.class === 'none' ? 'Размещение не найдено' : 'Своих размещений нет'}
          </span>
        )}
      </span>
      <span className="admin-coverage-row__count" role="cell">
        {formatCount(company.vacancies)}
        <small>объявлений</small>
      </span>
    </div>
  );
}

export function CoverageFilterChips({ filter, onFilter }: { filter: CoverageFilter; onFilter: (f: CoverageFilter) => void }) {
  const options: readonly [CoverageFilter, string][] = [
    ['all', 'Все'],
    ...COVERAGE_CLASS_ORDER.map((cls): [CoverageFilter, string] => [cls, COVERAGE_CLASS_LABELS[cls]]),
  ];
  return (
    <div className="admin-coverage-chips" role="group" aria-label="Способ размещения">
      {options.map(([key, label]) => (
        <button key={key} type="button" aria-pressed={key === filter} onClick={() => onFilter(key)}>
          {key === filter ? <Check size={14} aria-hidden="true" /> : null}
          {label}
        </button>
      ))}
    </div>
  );
}

interface ListFootProps {
  list: CoverageListState;
  total: number;
  onMore: () => void;
  onRetryList: () => void;
}

function ListFoot({ list, total, onMore, onRetryList }: ListFootProps) {
  if (list.status === 'error') {
    return (
      <div className="admin-coverage-alert is-warning" role="alert">
        <Warning size={16} aria-hidden="true" />
        <div>Итоги показаны, страница компаний не пришла. Уже показанные строки остаются.</div>
        <button type="button" className="admin-btn is-secondary" onClick={onRetryList}>
          <ArrowsClockwise size={16} aria-hidden="true" /> Загрузить список
        </button>
      </div>
    );
  }
  if (list.nextCursor === null) {
    return <span>Показаны все {pluralRu(list.items.length, COMPANY_FORMS)}</span>;
  }
  const busy = list.status === 'loading';
  return (
    <>
      <span>
        Показано {formatCount(list.items.length)} из {formatCount(total)}
      </span>
      <button type="button" className="admin-btn is-secondary" onClick={onMore} disabled={busy} aria-busy={busy}>
        Показать ещё {COVERAGE_PAGE_SIZE}
      </button>
    </>
  );
}

interface CompanyListProps extends ListFootProps {
  now: number;
  onShowAll: () => void;
}

export function CoverageCompanyList({ list, total, now, onMore, onRetryList, onShowAll }: CompanyListProps) {
  const firstLoad = list.status === 'loading' && list.items.length === 0;
  if (!firstLoad && list.status === 'ready' && list.items.length === 0 && list.filter !== 'all') {
    return (
      <section className="admin-coverage-panel admin-coverage-empty">
        <p>
          Ни одна компания пока не попала в «{COVERAGE_CLASS_LABELS[list.filter]}». Выберите другой способ или «Все».
        </p>
        <button type="button" className="admin-btn is-secondary" onClick={onShowAll}>
          Показать все
        </button>
      </section>
    );
  }
  return (
    <section className="admin-coverage-panel admin-coverage-list" role="table" aria-label="Компании" aria-busy={list.status === 'loading'}>
      <div className="admin-coverage-list-head" role="row">
        <span role="columnheader">Компания</span>
        <span role="columnheader">Способ</span>
        <span role="columnheader">Размещения и проверка</span>
        <span role="columnheader">Объявлений</span>
      </div>
      {firstLoad ? <div className="admin-coverage-skel" /> : null}
      {list.items.map((company) => (
        <CompanyRow key={company.companyKey} company={company} now={now} />
      ))}
      {firstLoad ? null : (
        <div className="admin-coverage-list-foot">
          <ListFoot list={list} total={total} onMore={onMore} onRetryList={onRetryList} />
        </div>
      )}
    </section>
  );
}
