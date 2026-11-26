import { useState } from 'react';
import type { B640CompanyCity } from '../../../../../shared/b640Companies';
import { Button, Dialog, Icon, Switch } from '../../kit';
import { formatCount } from '../format';
import { placeChips } from './listModel';
import type { CompanyListQuery } from './useCompanyList';

export type Place = Pick<CompanyListQuery, 'relocation' | 'city'>;

export interface PlaceFiltersProps {
  readonly place: Place;
  readonly cities: readonly B640CompanyCity[];
  readonly onChange: (place: Place) => void;
}

const NO_PLACE: Place = { relocation: false, city: null };

function placeCount(place: Place): number {
  return placeChips(place).length;
}

function FiltersDialog({ place, cities, onChange, onClose }: PlaceFiltersProps & { readonly onClose: () => void }) {
  const [draft, setDraft] = useState<Place>(place);
  const apply = () => {
    onChange(draft);
    onClose();
  };
  const footer = (
    <>
      <Button variant="quiet" onClick={() => setDraft(NO_PLACE)}>
        Сбросить
      </Button>
      <Button variant="primary" onClick={apply}>
        Показать компании
      </Button>
    </>
  );
  return (
    <Dialog open onClose={onClose} title="Фильтры" footer={footer}>
      <div className="field co-reloc">
        <span id="co-reloc-l">
          <Icon name="plane" />
          Помогают с релокацией
        </span>
        <Switch
          labelledBy="co-reloc-l"
          checked={draft.relocation}
          onChange={(relocation) => setDraft({ ...draft, relocation })}
        />
      </div>
      <div className="field">
        <label htmlFor="co-city">Город</label>
        <select
          id="co-city"
          value={draft.city ?? ''}
          onChange={(event) => setDraft({ ...draft, city: event.target.value || null })}
        >
          <option value="">Любой город</option>
          {cities.map((city) => (
            <option key={city.name} value={city.name}>
              {`${city.name} · ${formatCount(city.count)}`}
            </option>
          ))}
          {draft.city && !cities.some((city) => city.name === draft.city) ? (
            <option value={draft.city}>{draft.city}</option>
          ) : null}
        </select>
      </div>
    </Dialog>
  );
}

/** Кнопка «Фильтры» макета v10: релокация и город; число — сколько выбрано. */
export function FiltersButton(props: PlaceFiltersProps) {
  const [open, setOpen] = useState(false);
  const count = placeCount(props.place);
  return (
    <>
      <Button icon="funnel" onClick={() => setOpen(true)}>
        {count ? `Фильтры · ${count}` : 'Фильтры'}
      </Button>
      {open ? <FiltersDialog {...props} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/** Выбранные релокация и город — чипы со снятием и «Сбросить всё» (v10g). */
export function PlaceChips({ place, onChange }: Pick<PlaceFiltersProps, 'place' | 'onChange'>) {
  const chips = placeChips(place);
  if (!chips.length) return null;
  const without = (id: 'relocation' | 'city'): Place =>
    id === 'relocation' ? { ...place, relocation: false } : { ...place, city: null };
  return (
    <ul className="vt-chips" aria-label="Выбранные фильтры">
      {chips.map((chip) => (
        <li key={chip.id}>
          <span className="vt-chip">
            {chip.id === 'relocation' ? <Icon name="plane" /> : null}
            {chip.label}
            <button type="button" aria-label={`Убрать: ${chip.label}`} onClick={() => onChange(without(chip.id))}>
              <Icon name="close" />
            </button>
          </span>
        </li>
      ))}
      <li>
        <button className="vt-reset" type="button" onClick={() => onChange(NO_PLACE)}>
          Сбросить всё
        </button>
      </li>
    </ul>
  );
}
