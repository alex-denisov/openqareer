import { FirstRunErrorState, FirstRunStaleLoading } from '../onboarding/FirstRunStates';
import { SESSION_STALE_LABEL, sessionGateState } from '../onboarding/firstRunSpecialState';
import { CareerTodaySkeleton } from './CareerTodaySkeleton';

/**
 * Ожидание входа. Тексты — из состояний экрана 0 (B538): «Проверяем вход…»
 * при долгом ответе и «Не удалось войти…» с одной кнопкой «Повторить».
 * Мастер первого запуска, если уже начат, остаётся смонтированным за этим
 * экраном, поэтому введённое не теряется.
 */
export function CareerSessionGate({
  error,
  waitIsLong,
  onRetry,
}: {
  readonly error?: string;
  readonly waitIsLong: boolean;
  readonly onRetry: () => void;
}) {
  const state = sessionGateState({ error, waitIsLong });
  return (
    <section className="career-session-gate" aria-live="polite" aria-busy={state !== 'error'}>
      {state === 'error' ? (
        <FirstRunErrorState onRetry={onRetry} />
      ) : (
        <>
          <CareerTodaySkeleton />
          {state === 'stale-loading' ? (
            <div className="career-session-gate-actions">
              <FirstRunStaleLoading label={SESSION_STALE_LABEL} />
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
