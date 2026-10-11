import type { ReactNode } from 'react';
import { ArrowClockwise, Briefcase, Flag, Notebook, WarningCircle } from '@phosphor-icons/react';
import type { CareerDiaryOverview } from '../../../shared/careerDiary';
import type { CareerDiaryLoadState } from './useCareerDiaryOverview';

interface CareerDiarySummaryProps {
  readonly overview: CareerDiaryOverview | null;
  readonly state: CareerDiaryLoadState;
  readonly error: string | null;
  readonly onRetry: () => void;
}

export function CareerDiarySummary({
  overview,
  state,
  error,
  onRetry,
}: CareerDiarySummaryProps) {
  if (state === 'loading' && !overview) return <CareerDiarySummarySkeleton />;
  if (!overview) return <CareerDiarySummaryError error={error} onRetry={onRetry} />;

  const { summary, primaryWorkplace } = overview;
  return (
    <section className="career-diary-summary" aria-label="Сводка карьерного дневника">
      <div className="career-diary-summary__workplace">
        <Briefcase size={20} aria-hidden="true" />
        <div>
          <h2>{primaryWorkplace ? primaryWorkplace.company : 'Место работы не выбрано'}</h2>
          <p>{primaryWorkplace ? primaryWorkplace.title : 'Дневник не привязан к месту работы.'}</p>
        </div>
      </div>
      <dl className="career-diary-summary__metrics">
        <SummaryMetric
          icon={<Flag size={18} aria-hidden="true" />}
          label="Целей достигнуто"
          value={`${summary.goalsAchieved} из ${summary.goalsTotal}`}
          detail={`${summary.goalsAtRisk} под риском`}
        />
        <SummaryMetric
          icon={<Notebook size={18} aria-hidden="true" />}
          label="Разборов подряд"
          value={String(summary.weeklyReviewsInRow)}
          detail={`${summary.weeklyReviewsTotal} всего`}
        />
        <SummaryMetric
          icon={<WarningCircle size={18} aria-hidden="true" />}
          label="Достижений готово"
          value={String(summary.achievementsReadyToAdd)}
          detail="К добавлению в профиль"
        />
      </dl>
    </section>
  );
}

function SummaryMetric({
  icon,
  label,
  value,
  detail,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="career-diary-summary__metric">
      <dt>{icon}{label}</dt>
      <dd>{value}</dd>
      <p>{detail}</p>
    </div>
  );
}

function CareerDiarySummarySkeleton() {
  return (
    <section className="career-diary-summary" aria-label="Сводка карьерного дневника" aria-busy="true">
      <p className="career-diary-status" role="status">Загружаем сводку дневника.</p>
      <span className="career-diary-skeleton" />
    </section>
  );
}

function CareerDiarySummaryError({
  error,
  onRetry,
}: {
  readonly error: string | null;
  readonly onRetry: () => void;
}) {
  return (
    <section className="career-diary-summary" aria-label="Сводка карьерного дневника">
      <p className="career-diary-error" role="alert">{error ?? 'Сводка пока недоступна.'}</p>
      <button className="career-btn is-ghost" type="button" onClick={onRetry}>
        <ArrowClockwise size={18} aria-hidden="true" />Повторить
      </button>
    </section>
  );
}
