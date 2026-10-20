import type { CandidateBillingSummary } from '../shell/candidateBillingApi';
import type { CandidateProTrial } from './proTrialApi';
import { useProTrial } from './useProTrial';

export function ProTrialPanel({
  onSummaryChanged,
}: {
  readonly onSummaryChanged?: (summary: CandidateBillingSummary) => void;
}) {
  const state = useProTrial(onSummaryChanged);
  if (state.trial?.status === 'unavailable') return null;
  return (
    <section className="career-tariffs-panel" aria-label="Пробный Pro" aria-busy={state.busy}>
      <h2 className="career-tariffs-title">{trialTitle(state.trial)}</h2>
      <TrialCopy trial={state.trial} />
      {state.error ? <p role="alert">{state.error}</p> : null}
      <TrialControls {...state} />
      {!state.trial && !state.error ? (
        <p role="status">Проверяем доступность пробного периода…</p>
      ) : null}
    </section>
  );
}

function trialTitle(trial: CandidateProTrial | null): string {
  if (trial?.status === 'active') return 'Пробный Pro включён';
  if (trial?.status === 'expired') return 'Пробный Pro завершён';
  return 'Попробуйте Pro на 24 часа';
}

function TrialCopy({ trial }: { readonly trial: CandidateProTrial | null }) {
  if (trial?.status === 'active')
    return (
      <p className="career-tariffs-lead">
        Доступ действует до {formatTrialEnd(trial.expiresAt)}. После этого вернётся Free, если вы не
        подключите платный тариф. Списаний нет.
      </p>
    );
  if (trial?.status === 'expired')
    return (
      <p className="career-tariffs-lead">
        Пробный период закончился. Сейчас действует Free. Списаний нет. Повторно включить пробный
        Pro нельзя.
      </p>
    );
  return (
    <p className="career-tariffs-lead">
      Проверьте подбор вакансий, подготовку откликов и тренировки интервью. Один раз, без оплаты и
      автопродления. Через 24 часа вернётся Free.
    </p>
  );
}

function TrialControls({ trial, busy, error, activate, refresh }: ReturnType<typeof useProTrial>) {
  return (
    <>
      {trial?.status === 'eligible' ? (
        <button
          className="career-btn is-primary"
          type="button"
          disabled={busy}
          onClick={() => void activate()}
        >
          {busy ? 'Включаем Pro…' : 'Включить Pro на 24 часа бесплатно'}
        </button>
      ) : null}
      {error ? (
        <button
          className="career-btn is-secondary"
          type="button"
          disabled={busy}
          onClick={() => void refresh()}
        >
          Повторить проверку
        </button>
      ) : null}
    </>
  );
}

function formatTrialEnd(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(value),
      )
    : 'проверки срока';
}
