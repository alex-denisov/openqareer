import { CareerTodaySkeleton } from './CareerTodaySkeleton';

export function CareerSessionGate({
  error,
  waitIsLong,
  onRetry,
  onOpenLogin,
}: {
  readonly error?: string;
  readonly waitIsLong: boolean;
  readonly onRetry: () => void;
  readonly onOpenLogin: () => void;
}) {
  return (
    <section className="career-session-gate" aria-live="polite" aria-busy={!error}>
      {error ? (
        <div className="career-session-error" role="alert">
          <strong>Ошибка: сервер не ответил.</strong>
          <p>{error}</p>
          <div className="career-session-gate-actions">
            <button className="career-primary-button" type="button" onClick={onRetry}>
              Повторить
            </button>
            <button className="career-quiet-button" type="button" onClick={onOpenLogin}>
              Открыть вход
            </button>
          </div>
        </div>
      ) : (
        <>
          <CareerTodaySkeleton />
          {waitIsLong ? (
            <div className="career-session-gate-actions">
              <p className="career-session-gate-note" role="status">
                Загрузка дольше обычного.
              </p>
              <button className="career-primary-button" type="button" onClick={onRetry}>
                Повторить
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
