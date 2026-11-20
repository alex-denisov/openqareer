import { useId, useState } from 'react';
import type { B640OfferDecision } from '../../../../shared/b640Offers';
import { Button, Icon, Link, StatusLine, type IconName } from '../kit';
import { putOfferDecision } from './data/offersApi';
import type { OfferCard } from './model/offerModel';

type Choice = B640OfferDecision | 'thinking';

const OPTIONS: readonly {
  readonly value: Choice;
  readonly label: string;
  readonly icon: IconName;
}[] = [
  { value: 'accepted', label: 'Принимаю', icon: 'check' },
  { value: 'thinking', label: 'Думаю', icon: 'clock' },
  { value: 'declined', label: 'Отказываюсь', icon: 'close' },
];

/** Переход в статус «Работаю» (S02 с предложенным статусом): статус меняет сам кандидат. */
export const WORKING_STATUS_PATH = '/app/profile/status?status=working';

type Outcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'saved'; readonly proposeWorking: boolean }
  | { readonly kind: 'error'; readonly retry: Choice };

function toApi(choice: Choice): B640OfferDecision | null {
  return choice === 'thinking' ? null : choice;
}

function OutcomeLine(props: {
  readonly outcome: Outcome;
  readonly onRetry: (choice: Choice) => void;
}) {
  const { outcome } = props;
  if (outcome.kind === 'error') {
    return (
      <StatusLine
        state="err"
        text="Решение не записалось"
        action={
          <Button size="sm" onClick={() => props.onRetry(outcome.retry)}>
            Повторить
          </Button>
        }
      />
    );
  }
  if (outcome.kind !== 'saved') return null;
  return (
    <StatusLine
      state="ok"
      text="Решение записано"
      action={
        outcome.proposeWorking ? (
          <Link className="row-act" to={WORKING_STATUS_PATH}>
            Перейти в «Работаю»
          </Link>
        ) : undefined
      }
    />
  );
}

/** «Решение по офферу»: принимаю, думаю, отказываюсь — записывается сразу, ошибка на месте. */
export function OfferDecision({ card }: { readonly card: OfferCard }) {
  const name = useId();
  const [choice, setChoice] = useState<Choice>(card.view.decision ?? 'thinking');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);

  async function decide(next: Choice) {
    const previous = choice;
    setChoice(next);
    setBusy(true);
    try {
      const result = await putOfferDecision(card.applicationId, toApi(next));
      setOutcome(
        next === 'thinking'
          ? { kind: 'idle' }
          : { kind: 'saved', proposeWorking: result.proposeStatus === 'working' },
      );
    } catch {
      setChoice(previous);
      setOutcome({ kind: 'error', retry: next });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <fieldset className="decide" disabled={busy} aria-busy={busy || undefined}>
        <legend>{`Решение по офферу: ${card.company}`}</legend>
        <div className="seg-ctl">
          {OPTIONS.map((option) => (
            <label key={option.value}>
              <input
                type="radio"
                name={name}
                checked={choice === option.value}
                onChange={() => void decide(option.value)}
              />
              <span>
                <Icon name={option.icon} />
                {option.label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <OutcomeLine outcome={outcome} onRetry={(retry) => void decide(retry)} />
    </>
  );
}
