export interface CareerTodaySkeletonProps {
  readonly showHeading?: boolean;
  readonly statusMessage?: string;
  readonly statusRole?: boolean;
}

function SkeletonLines({ count, width = 'wide' }: { readonly count: number; readonly width?: 'wide' | 'mixed' }) {
  return (
    <div className="career-today-skeleton-lines" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <span
          className={`career-today-skeleton-line${width === 'mixed' && index % 2 ? ' is-short' : ''}`}
          key={index}
        />
      ))}
    </div>
  );
}

function DecisionSkeleton() {
  return (
    <section className="career-today-skeleton-card is-decision" aria-label="Загрузка решения">
      <SkeletonLines count={1} width="mixed" />
      <span className="career-today-skeleton-title" aria-hidden="true" />
      <SkeletonLines count={2} width="mixed" />
      <div className="career-today-skeleton-actions" aria-hidden="true">
        <span />
        <span />
      </div>
    </section>
  );
}

function PathSkeleton() {
  return (
    <section className="career-today-skeleton-card is-path" aria-label="Загрузка карьерного пути">
      <SkeletonLines count={6} width="wide" />
    </section>
  );
}

function QueueSkeleton() {
  return (
    <section className="career-today-skeleton-card is-queue" aria-label="Загрузка очереди дня">
      <SkeletonLines count={1} width="mixed" />
      {Array.from({ length: 3 }, (_, index) => (
        <div className="career-today-skeleton-queue-row" aria-hidden="true" key={index}>
          <span />
          <SkeletonLines count={2} width="mixed" />
        </div>
      ))}
    </section>
  );
}

export function CareerTodaySkeleton({
  showHeading = true,
  statusMessage = 'Проверяем вход и читаем ваш профиль',
  statusRole = true,
}: CareerTodaySkeletonProps) {
  return (
    <section className="career-today-skeleton" aria-label="Сегодня" aria-busy="true">
      {showHeading ? (
        <header className="career-today-skeleton-heading">
          <h1>Сегодня</h1>
          <p
            className="career-today-skeleton-status"
            role={statusRole ? 'status' : undefined}
            aria-live={statusRole ? undefined : 'polite'}
          >
            {statusMessage}
          </p>
        </header>
      ) : null}
      <div className="career-today-skeleton-grid">
        <div className="career-today-skeleton-primary">
          <DecisionSkeleton />
          <QueueSkeleton />
        </div>
        <PathSkeleton />
      </div>
    </section>
  );
}
