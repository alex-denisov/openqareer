import { useId, useState, type FormEvent } from 'react';
import type { CandidateMemory } from '../../coach/coachApi';
import { ResultLine } from '../kit/ResultLine';
import { ErrorRow } from './parts';
import type { FactDecision } from './useDialog';

export interface FactCardProps {
  readonly fact: CandidateMemory;
  readonly onDecide: (id: string, decision: FactDecision) => Promise<void>;
}

interface StepProps {
  readonly statement: string;
  readonly busy: boolean;
  readonly onDecide: (decision: FactDecision) => void;
  readonly onStep: (step: 'ask' | 'edit') => void;
}

function Ask({ statement, busy, onDecide, onStep }: StepProps) {
  return (
    <>
      <p className="ec-title">Записать в профиль: {statement}</p>
      <div className="msg-acts act-row">
        <button
          className="btn is-sm is-write"
          type="button"
          disabled={busy}
          onClick={() => onDecide({ action: 'confirm' })}
        >
          Верно
        </button>
        <button
          className="btn is-sm is-line"
          type="button"
          disabled={busy}
          onClick={() => onStep('edit')}
        >
          Исправить
        </button>
        <button
          className="btn is-sm is-line"
          type="button"
          disabled={busy}
          onClick={() => onDecide({ action: 'delete' })}
        >
          Не нужно
        </button>
      </div>
    </>
  );
}

function Edit({ statement, busy, onDecide, onStep }: StepProps) {
  const fieldId = useId();
  const [draft, setDraft] = useState(statement);
  function save(event: FormEvent) {
    event.preventDefault();
    const next = draft.trim();
    if (next) onDecide({ action: 'correct', statement: next });
  }
  return (
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
        <button
          className="btn is-sm is-line"
          type="button"
          disabled={busy}
          onClick={() => onStep('ask')}
        >
          Отмена
        </button>
      </div>
    </form>
  );
}

/**
 * Запись из разговора (макеты K1 и K7): в профиль попадает только после «Верно».
 * Ожидание, ошибка и результат — на месте карточки.
 */
export function FactCard({ fact, onDecide }: FactCardProps) {
  const [step, setStep] = useState<'ask' | 'edit'>('ask');
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

  const Step = step === 'ask' ? Ask : Edit;
  return (
    <section className="ec fc" aria-label="Запись в профиль, нужно ваше решение" aria-busy={busy}>
      <Step
        statement={fact.statement}
        busy={busy}
        onDecide={(decision) => void decide(decision)}
        onStep={setStep}
      />
      {failed ? <ErrorRow text="Не сохранилось" /> : null}
    </section>
  );
}
