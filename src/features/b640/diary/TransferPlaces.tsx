import { useEffect, useState } from 'react';
import { getResumeStudio } from '../../resume/resumeApi';
import { Button } from '../kit/Button';
import { StatusLine } from '../kit/ResultLine';
import { buildNodePath } from '../routes';
import { Link } from '../shell/Link';
import { getOverview } from './diaryApi';
import { defaultPlace, placesOf, type TransferPlace } from './transferModel';

export type Places =
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

export function usePlaces(attempt: number): Places {
  const [places, setPlaces] = useState<Places>({ state: 'loading' });
  useEffect(() => {
    let active = true;
    setPlaces({ state: 'loading' });
    loadPlaces().then(
      (loaded) => active && setPlaces(loaded),
      () => active && setPlaces({ state: 'error' }),
    );
    return () => {
      active = false;
    };
  }, [attempt]);
  return places;
}

export interface PlacePickProps {
  readonly id: string;
  readonly places: readonly TransferPlace[];
  readonly value: string;
  readonly onChange: (id: string) => void;
}

export function PlacePick({ id, places, value, onChange }: PlacePickProps) {
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

export interface PlaceStateProps {
  readonly places: Places;
  readonly onRetry: () => void;
}

/** Места работы: ждём, не загрузились (с «Повторить») или их в профиле нет. */
export function PlaceState({ places, onRetry }: PlaceStateProps) {
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
