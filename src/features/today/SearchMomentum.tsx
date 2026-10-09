import { useState } from 'react';
import type { CareerCabinetView } from '../cabinet/cabinetViews';
import type {
  MomentumMetrics,
  SearchMomentum as SearchMomentumData,
} from './todayApi';
import './searchMomentum.css';

export interface SearchMomentumProps {
  readonly momentum?: SearchMomentumData | null;
  readonly onNavigate?: (view: CareerCabinetView) => void;
}

function formatCalcDate(isoStr: string): string {
  try {
    const d = new Date(isoStr);
    if (Number.isNaN(d.getTime())) return isoStr;
    return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch {
    return isoStr;
  }
}

function MomentumEmptyState() {
  return (
    <section
      className="career-momentum-widget"
      data-testid="search-momentum-widget"
      aria-label="Импульс поиска"
    >
      <div className="career-momentum-header">
        <h3 className="career-momentum-title">Импульс поиска</h3>
      </div>
      <p className="career-momentum-empty" data-testid="search-momentum-empty">
        Пока нет подтверждённых откликов. Когда отклики будут отправлены и подтверждены, здесь появятся цифры
      </p>
    </section>
  );
}

interface HeaderProps {
  readonly calculatedAt: string;
  readonly selectedPeriod: '7d' | '30d';
  readonly onSelectPeriod: (p: '7d' | '30d') => void;
}

function MomentumHeader({ calculatedAt, selectedPeriod, onSelectPeriod }: HeaderProps) {
  return (
    <div className="career-momentum-header">
      <div className="career-momentum-title-group">
        <h3 className="career-momentum-title">Импульс поиска</h3>
        <span className="career-momentum-date" data-testid="search-momentum-date">
          Дата расчёта: {formatCalcDate(calculatedAt)}
        </span>
      </div>
      <div className="career-momentum-period-toggle" role="group" aria-label="Период">
        <button
          type="button"
          className={`career-momentum-period-btn ${selectedPeriod === '7d' ? 'career-momentum-period-btn-active' : ''}`}
          onClick={() => onSelectPeriod('7d')}
          aria-pressed={selectedPeriod === '7d'}
          data-testid="search-momentum-toggle-7d"
        >
          7 дней
        </button>
        <button
          type="button"
          className={`career-momentum-period-btn ${selectedPeriod === '30d' ? 'career-momentum-period-btn-active' : ''}`}
          onClick={() => onSelectPeriod('30d')}
          aria-pressed={selectedPeriod === '30d'}
          data-testid="search-momentum-toggle-30d"
        >
          30 дней
        </button>
      </div>
    </div>
  );
}

interface CardProps {
  readonly testId: string;
  readonly label: string;
  readonly periodLabel: string;
  readonly value: number | 'unknown';
}

function MomentumCard({ testId, label, periodLabel, value }: CardProps) {
  return (
    <div className="career-momentum-card" data-testid={`search-momentum-card-${testId}`}>
      <span className="career-momentum-card-label">{label}</span>
      <span className="career-momentum-card-period">{periodLabel}</span>
      <span
        className="career-momentum-card-value"
        data-testid={`search-momentum-val-${testId}`}
      >
        {typeof value === 'number' ? value : 'нет данных'}
      </span>
    </div>
  );
}

interface GridProps {
  readonly metrics: MomentumMetrics;
  readonly periodLabel: string;
}

function MomentumGrid({ metrics, periodLabel }: GridProps) {
  return (
    <div className="career-momentum-grid" data-testid="search-momentum-grid">
      <MomentumCard
        testId="applied"
        label="Подтверждённые отклики"
        periodLabel={periodLabel}
        value={metrics.applied}
      />
      <MomentumCard
        testId="views"
        label="Просмотры"
        periodLabel={periodLabel}
        value={metrics.views}
      />
      <MomentumCard
        testId="screenings"
        label="Скрининги"
        periodLabel={periodLabel}
        value={metrics.screenings}
      />
      <MomentumCard
        testId="interviews"
        label="Интервью"
        periodLabel={periodLabel}
        value={metrics.interviews}
      />
    </div>
  );
}

function BurnoutHint({ onNavigate }: { readonly onNavigate?: (view: CareerCabinetView) => void }) {
  return (
    <div className="career-momentum-hint" data-testid="search-momentum-hint">
      <p className="career-momentum-hint-text">
        30 откликов без интервью — возможно, стоит сменить тактику
      </p>
      <button
        type="button"
        className="career-momentum-hint-action"
        onClick={() => onNavigate?.('opportunities')}
        data-testid="search-momentum-consultant-action"
      >
        Обсудить с консультантом
      </button>
    </div>
  );
}

export function SearchMomentum({ momentum, onNavigate }: SearchMomentumProps) {
  const [selectedPeriod, setSelectedPeriod] = useState<'7d' | '30d'>('7d');

  if (!momentum) return null;

  const m7d = momentum.windows['7d'];
  const m30d = momentum.windows['30d'];

  const hasConfirmed =
    (typeof m7d.applied === 'number' && m7d.applied > 0) ||
    (typeof m30d.applied === 'number' && m30d.applied > 0);

  if (!hasConfirmed) {
    return <MomentumEmptyState />;
  }

  const activeMetrics = selectedPeriod === '7d' ? m7d : m30d;
  const periodLabel = selectedPeriod === '7d' ? '7 дней' : '30 дней';

  return (
    <section
      className="career-momentum-widget"
      data-testid="search-momentum-widget"
      aria-label="Импульс поиска"
    >
      <MomentumHeader
        calculatedAt={momentum.calculatedAt}
        selectedPeriod={selectedPeriod}
        onSelectPeriod={setSelectedPeriod}
      />
      <MomentumGrid metrics={activeMetrics} periodLabel={periodLabel} />
      {momentum.burnoutNotice ? <BurnoutHint onNavigate={onNavigate} /> : null}
    </section>
  );
}
