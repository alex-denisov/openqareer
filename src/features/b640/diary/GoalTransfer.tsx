import { useEffect, useId, useState } from 'react';
import {
  GOAL_TRANSFER_LINE_MAX,
  type CareerDiaryGoalCard,
} from '../../../../shared/careerDiaryCards';
import { getResumeStudio } from '../../resume/resumeApi';
import { Button } from '../kit/Button';
import { Dialog } from '../kit/Dialog';
import { StatusLine } from '../kit/ResultLine';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import { getOverview, transferGoal } from './diaryApi';
import { defaultPlace, placesOf, transferLine, type TransferPlace } from './transferModel';

type Places =
  | { readonly state: 'loading' }
  | { readonly state: 'error' }
  | {
      readonly state: 'ready';
      readonly places: readonly TransferPlace[];
      readonly chosen: string | null;
    };

/** Места работы из «Опыта» профиля и то, что выбрано по умолчанию. */
async function loadPlaces(): Promise<Places> {
  const [overview, studio] = await Promise.all([getOverview(), getResumeStudio()]);
  const places = placesOf(studio.draft?.experience ?? []);
  return {
    state: 'ready',
    places,
    chosen: defaultPlace(places, overview.primaryWorkplace?.sourceExperienceId),
  };
}

function usePlaces(open: boolean, attempt: number): Places {
  const [places, setPlaces] = useState<Places>({ state: 'loading' });
  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setPlaces({ state: 'loading' });
    loadPlaces().then(
      (loaded) => active && setPlaces(loaded),
      () => active && setPlaces({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [open, attempt]);
  return places;
}

interface PlacePickProps {
  readonly id: string;
  readonly places: readonly TransferPlace[];
  readonly value: string;
  readonly onChange: (id: string) => void;
}

function PlacePick({ id, places, value, onChange }: PlacePickProps) {
  return (
    <div className="field">
      <label htmlFor={id}>Место работы</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="" disabled>
          Выберите место работы
        </option>
        {places.map((place) => (
          <option key={place.id} value={place.id}>
            {place.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export interface GoalTransferDialogProps {
  readonly card: CareerDiaryGoalCard;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onDone: (card: CareerDiaryGoalCard) => void;
}

function useTransfer(card: CareerDiaryGoalCard, onDone: GoalTransferDialogProps['onDone']) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(experienceId: string, line: string) {
    if (!line.trim()) return setError('Напишите строку для профиля');
    if (!experienceId) return setError('Выберите место работы');
    setBusy(true);
    setError(null);
    try {
      onDone(await transferGoal(card.id, { experienceId, line: line.trim() }));
    } catch {
      setError('Строка не добавилась. Повторите.');
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, send };
}

interface PlaceStateProps {
  readonly places: Places;
  readonly onRetry: () => void;
}

/** Места работы: ждём, не загрузились (с «Повторить») или их в профиле нет. */
function PlaceState({ places, onRetry }: PlaceStateProps) {
  if (places.state === 'loading') return <StatusLine state="wait" text="Загружаем места работы" />;
  if (places.state === 'error') {
    return (
      <StatusLine
        state="err"
        text="Места работы не загрузились"
        action={<Button onClick={onRetry}>Повторить</Button>}
      />
    );
  }
  if (places.places.length > 0) return null;
  return (
    <StatusLine
      state="err"
      text="В профиле нет мест работы"
      action={
        <Link className="btn is-sm" to={buildNodePath('s01')}>
          Открыть профиль
        </Link>
      }
    />
  );
}

/** «Перенести»: строка результата цели под местом работы в «Опыте» — только после «Добавить». */
export function GoalTransferDialog({ card, open, onClose, onDone }: GoalTransferDialogProps) {
  const id = useId();
  const [attempt, setAttempt] = useState(0);
  const places = usePlaces(open, attempt);
  const [line, setLine] = useState(() => transferLine(card));
  const [picked, setPicked] = useState('');
  const transfer = useTransfer(card, onDone);
  const ready = places.state === 'ready' && places.places.length > 0 ? places : null;
  const place = picked || ready?.chosen || '';
  const footer = (
    <>
      <Button onClick={onClose}>Отмена</Button>
      <Button
        variant="primary"
        icon="check"
        busy={transfer.busy}
        disabled={!ready}
        onClick={() => void transfer.send(place, line)}
      >
        Добавить в профиль
      </Button>
    </>
  );
  return (
    <Dialog open={open} onClose={onClose} title="Строка в профиль" footer={footer}>
      <div className="field">
        <label htmlFor={`${id}-l`}>Строка в «Опыте»</label>
        <textarea
          id={`${id}-l`}
          maxLength={GOAL_TRANSFER_LINE_MAX}
          value={line}
          onChange={(event) => setLine(event.target.value)}
        />
      </div>
      <PlaceState places={places} onRetry={() => setAttempt((value) => value + 1)} />
      {ready ? (
        <PlacePick id={`${id}-p`} places={ready.places} value={place} onChange={setPicked} />
      ) : null}
      {transfer.error ? <StatusLine state="err" text={transfer.error} /> : null}
    </Dialog>
  );
}
