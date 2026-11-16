import { useId, useState, type FormEvent } from 'react';
import type { CandidateMemory } from '../../coach/coachApi';
import { Icon } from '../kit/Icon';
import { ResultLine } from '../kit/ResultLine';
import type { FactDecision } from './useDialog';

export interface FactCardProps {
  readonly fact: CandidateMemory;
  readonly onDecide: (id: string, decision: FactDecision) => Promise<void>;
}

type Step = 'ask' | 'edit';

/**
 * Запись из разговора (макеты K1 и K7): в профиль попадает только после «Верно».
 * Ожидание, ошибка и результат — на месте карточки.
 */
export function FactCard({ fact, onDecide }: FactCardProps) {
  const fieldId = useId();
  const [step, setStep] = useState<Step>('ask');
  const [draft, setDraft] = useState(fact.statement);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (fact.status !== 'proposed') return <ResultLine text="Записано в профиль" />;

  async function decide(decision: FactDecision) {
    setBusy(true);
    setFailed(false);
    try {
      await onDecide(fact.id, decision);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const statement = draft.trim();
    if (statement) void decide({ action: 'correct', statement });
  }

  return (
    <section className="ec fc" aria-label="Запись в профиль, нужно ваше решение" aria-busy={busy}>
      {step === 'ask' ? (
        <>
          <p className="ec-title">Записать в профиль: {fact.statement}</p>
          <div className="msg-acts act-row">
            <button type="button" className="btn is-sm is-write"
              disabled={busy}
              onClick={() => void decide({ action: 'confirm' })}
            >
              Верно
            </button>
            <button type="button" className="btn is-sm is-line" disabled={busy} onClick={() => setStep('edit')}>
              Исправить
            </button>
            <button type="button" className="btn is-sm is-line"
              disabled={busy}
              onClick={() => void decide({ action: 'delete' })}
            >
              Не нужно
            </button>
          </div>
        </>
      ) : (
        <form className="field" onSubmit={save}>
          <label htmlFor={fieldId}>Запись в профиль</label>
          <textarea
            id={fieldId}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
          />
          <div className="msg-acts act-row">
            <button className="btn is-sm is-write" type="submit" disabled={busy || !draft.trim()}>
              Сохранить
            </button>
            <button type="button" className="btn is-sm is-line" disabled={busy} onClick={() => setStep('ask')}>
              Отмена
            </button>
          </div>
        </form>
      )}
      {failed ? (
        <p className="res-row is-err" role="alert">
          <Icon name="warn" />
          <span className="res-t">Не сохранилось. Повторите</span>
        </p>
      ) : null}
    </section>
  );
}
