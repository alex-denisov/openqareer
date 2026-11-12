import { useId } from 'react';
import { COVERAGE_CLASS_ORDER, type CoverageClass, type CoverageFilter, type CoverageTotals } from './coverageApi';
import {
  COVERAGE_CLASS_LABELS,
  directShare,
  formatCount,
  poolTotal,
  shareLabel,
} from './coverageModel';

const BAR_UNITS = 1000;
const BAR_GAP = 2;
const BAR_MIN = 3;

interface BarSegment {
  readonly cls: CoverageClass;
  readonly x: number;
  readonly width: number;
}

function barSegments(totals: CoverageTotals): readonly BarSegment[] {
  const total = totals.totalCompanies;
  const present = COVERAGE_CLASS_ORDER.filter((cls) => totals.classes[cls].companies > 0);
  return present.reduce<BarSegment[]>((acc, cls) => {
    const prev = acc[acc.length - 1];
    const x = prev ? prev.x + prev.width + BAR_GAP : 0;
    const share = total > 0 ? (totals.classes[cls].companies / total) * BAR_UNITS : 0;
    return [...acc, { cls, x, width: Math.max(BAR_MIN, share - BAR_GAP) }];
  }, []);
}

/** Полоса долей в SVG: CSP запрещает инлайн-стили, ширина идёт атрибутом. */
function CoverageBar({ totals }: { totals: CoverageTotals }) {
  const hatch = `admin-coverage-hatch-${useId().replace(/:/g, '')}`;
  return (
    <svg
      className="admin-coverage-bar"
      viewBox={`0 0 ${BAR_UNITS} 12`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Доли компаний по способу размещения"
    >
      <defs>
        <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect className="admin-coverage-hatch" width="3" height="6" />
        </pattern>
      </defs>
      {barSegments(totals).map(({ cls, x, width }) => (
        <rect
          key={cls}
          className={`admin-coverage-c-${cls}`}
          x={x}
          width={width}
          height="12"
          fill={cls === 'none' ? `url(#${hatch})` : undefined}
        >
          <title>{`${COVERAGE_CLASS_LABELS[cls]}: ${formatCount(totals.classes[cls].companies)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** B643-11: главная цифра, полоса долей и таблица способов размещения. */
export function CoverageLead({ totals }: { totals: CoverageTotals }) {
  const total = totals.totalCompanies;
  const direct = directShare(totals);
  return (
    <section className="admin-coverage-panel admin-coverage-lead" aria-labelledby="admin-coverage-lead">
      <div>
        <div className="admin-coverage-lead__number" id="admin-coverage-lead">
          {shareLabel(direct, total)}
          <span>
            {formatCount(direct)} из {formatCount(total)}
          </span>
        </div>
        <p className="admin-coverage-lead__text">
          компаний публикуют вакансии напрямую: в ATS или на своём сайте.
        </p>
      </div>
      <div className="admin-coverage-lead__side">
        <span className="admin-coverage-metric">{formatCount(poolTotal(totals))}</span>
        <span className="admin-coverage-metric-label">объявлений в пуле</span>
      </div>
      <CoverageBar totals={totals} />
    </section>
  );
}

function perCompany(vacancies: number, companies: number): string {
  return formatCount(companies > 0 ? Math.round((vacancies / companies) * 10) / 10 : 0);
}

interface ClassTableProps {
  totals: CoverageTotals;
  filter: CoverageFilter;
  onFilter: (filter: CoverageFilter) => void;
}

export function CoverageClassTable({ totals, filter, onFilter }: ClassTableProps) {
  const pool = poolTotal(totals);
  return (
    <section className="admin-coverage-panel admin-coverage-classes" aria-label="Способы размещения">
      <div className="admin-coverage-class-head">
        <span>Способ размещения</span>
        <span>Компаний</span>
        <span>Объявлений в пуле</span>
        <span>В среднем на компанию</span>
      </div>
      {COVERAGE_CLASS_ORDER.map((cls) => {
        const { companies, vacancies } = totals.classes[cls];
        const selected = cls === filter;
        return (
          <button
            key={cls}
            type="button"
            className={`admin-coverage-class${selected ? ' is-selected' : ''}`}
            aria-pressed={selected}
            onClick={() => onFilter(selected ? 'all' : cls)}
          >
            <span className="admin-coverage-class__name">
              <i className={`admin-coverage-swatch admin-coverage-c-${cls}`} />
              {COVERAGE_CLASS_LABELS[cls]}
            </span>
            <span className="admin-coverage-num">
              <strong>{formatCount(companies)}</strong> <span className="admin-coverage-num__label">компаний</span>
              <small>{shareLabel(companies, totals.totalCompanies)}</small>
            </span>
            <span className="admin-coverage-num">
              <strong>{formatCount(vacancies)}</strong> <span className="admin-coverage-num__label">объявлений</span>
              <small>{shareLabel(vacancies, pool)}</small>
            </span>
            <span className="admin-coverage-num">
              {cls === 'none' ? (
                <span className="admin-coverage-gap">Сайт ещё не найден</span>
              ) : (
                <>
                  <strong>{perCompany(vacancies, companies)}</strong>{' '}
                  <span className="admin-coverage-num__label">на компанию</span>
                </>
              )}
            </span>
          </button>
        );
      })}
      <div className="admin-coverage-class-total">
        <span>Всего</span>
        <span>
          {formatCount(totals.totalCompanies)} компаний · {formatCount(pool)} объявлений
        </span>
      </div>
    </section>
  );
}
