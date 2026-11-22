import { useId, useState } from 'react';
import {
  GOAL_TRANSFER_LINE_MAX,
  type CareerDiaryGoalCard,
} from '../../../../shared/careerDiaryCards';
import { withoutEmployerFigures } from '../../../../shared/employerFigures';
import { apiErrorMessage } from '../../coach/apiClient';
import { Button } from '../kit/Button';
import { Dialog } from '../kit/Dialog';
import { StatusLine } from '../kit/ResultLine';
import { transferGoal } from './diaryApi';
import { PlacePick, PlaceState, usePlaces } from './TransferPlaces';
import { transferLine } from './transferModel';

const SEND_FAILED = 'Строка не добавилась. Повторите.';

/** Строка по умолчанию: результат цели без цифр работодателя; кандидат её правит. */
export function defaultLine(card: CareerDiaryGoalCard): string {
  return withoutEmployerFigures(transferLine(card));
}

interface RowState {
  readonly line: string;
  readonly selected: boolean;
  readonly error: string | null;
}

type Rows = Readonly<Record<string, RowState>>;

function initialRows(cards: readonly CareerDiaryGoalCard[], selected: boolean): Rows {
  return Object.fromEntries(
    cards.map((card) => [card.id, { line: defaultLine(card), selected, error: null }]),
  );
}

interface LineRowProps {
  readonly id: string;
  readonly card: CareerDiaryGoalCard;
  readonly row: RowState;
  readonly busy: boolean;
  readonly onChange: (patch: Partial<RowState>) => void;
}

/** Цель с галочкой и строкой, которую можно править; ошибка — прямо под строкой. */
function LineRow({ id, card, row, busy, onChange }: LineRowProps) {
  return (
    <div className="field">
      <div className="check">
        <input
          id={`${id}-c`}
          type="checkbox"
          checked={row.selected}
          disabled={busy}
          onChange={(event) => onChange({ selected: event.target.checked })}
        />
        <label htmlFor={`${id}-c`}>{card.title}</label>
      </div>
      <textarea
        aria-label={`Строка в «Опыте»: ${card.title}`}
        maxLength={GOAL_TRANSFER_LINE_MAX}
        value={row.line}
        disabled={busy}
        onChange={(event) => onChange({ line: event.target.value, error: null })}
      />
      {row.error ? <StatusLine state="err" text={row.error} /> : null}
    </div>
  );
}

export interface GoalTransferDialogProps {
  /** Достигнутые цели, которых в профиле ещё нет. */
  readonly cards: readonly CareerDiaryGoalCard[];
  /** Все цели отмечены сразу; иначе кандидат отмечает сам. */
  readonly preselected: boolean;
  readonly onClose: () => void;
  /** Строка цели добавлена в профиль. */
  readonly onDone: (card: CareerDiaryGoalCard) => void;
}

/** Строки уходят по одной: у каждой своя ошибка, ушедшие остаются в профиле. */
function useTransfer(props: GoalTransferDialogProps, initial: Rows) {
  const [rows, setRows] = useState<Rows>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const patch = (id: string, change: Partial<RowState>) =>
    setRows((current) => ({ ...current, [id]: { ...current[id]!, ...change } }));

  async function sendOne(card: CareerDiaryGoalCard, place: string): Promise<boolean> {
    const line = rows[card.id]!.line.trim();
    if (!line) return fail(card.id, 'Напишите строку для профиля');
    try {
      props.onDone(await transferGoal(card.id, { experienceId: place, line }));
      return true;
    } catch (reason) {
      return fail(card.id, apiErrorMessage(reason, SEND_FAILED));
    }
  }
  function fail(id: string, message: string): false {
    patch(id, { error: message });
    return false;
  }
  async function send(place: string) {
    if (!place) return setError('Выберите место работы');
    setError(null);
    setBusy(true);
    let failed = false;
    for (const card of props.cards.filter((item) => rows[item.id]?.selected)) {
      failed = !(await sendOne(card, place)) || failed;
    }
    setBusy(false);
    if (!failed) props.onClose();
  }
  return { rows, busy, error, patch, send };
}

/**
 * «Строка в профиль»: строки результата достигнутых целей под местом работы в «Опыте» —
 * только после «Добавить в профиль». Окно собирается заново при каждом открытии.
 */
export function GoalTransferDialog(props: GoalTransferDialogProps) {
  const id = useId();
  const [attempt, setAttempt] = useState(0);
  const places = usePlaces(attempt);
  const [picked, setPicked] = useState('');
  const transfer = useTransfer(props, initialRows(props.cards, props.preselected));
  const ready = places.state === 'ready' && places.places.length > 0 ? places : null;
  const place = picked || ready?.chosen || '';
  const chosen = props.cards.filter((card) => transfer.rows[card.id]?.selected).length;
  const footer = (
    <>
      <Button onClick={props.onClose}>Отмена</Button>
      <Button
        variant="primary"
        icon="check"
        busy={transfer.busy}
        disabled={!ready || chosen === 0}
        onClick={() => void transfer.send(place)}
      >
        Добавить в профиль
      </Button>
    </>
  );
  return (
    <Dialog open onClose={props.onClose} title="Строка в профиль" footer={footer}>
      {props.cards.map((card) => (
        <LineRow
          key={card.id}
          id={`${id}-${card.id}`}
          card={card}
          row={transfer.rows[card.id]!}
          busy={transfer.busy}
          onChange={(change) => transfer.patch(card.id, change)}
        />
      ))}
      <PlaceState places={places} onRetry={() => setAttempt((value) => value + 1)} />
      {ready ? (
        <PlacePick id={`${id}-p`} places={ready.places} value={place} onChange={setPicked} />
      ) : null}
      {transfer.error ? <StatusLine state="err" text={transfer.error} /> : null}
    </Dialog>
  );
}
