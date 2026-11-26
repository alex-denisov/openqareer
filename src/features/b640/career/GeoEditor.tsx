import { useId, useState } from 'react';
import { searchGeoPlaces } from '../../../../shared/geo/geoDirectory';
import { useGeoDirectory } from '../../geo/useGeoDirectory';
import { RowAction, StatusLine } from '../kit';
import { EditFrame, type EditorProps } from './EditFrame';
import { ToggleChecks, useToggleList } from './ToggleChecks';

const REMOTE = ['Удалённо из РФ', 'Удалённо из любой страны'] as const;
const REMOTE_QUERY = /^(у|уд|уда|удал|удалё|удале)/iu;
const SHOWN = 6;

function optionsFor(query: string, selected: readonly string[], ready: boolean): string[] {
  const text = query.trim();
  if (!text) return [];
  const remote = REMOTE_QUERY.test(text) ? [...REMOTE] : [];
  const places = ready ? searchGeoPlaces(text, SHOWN).map((place) => place.value) : [];
  return [...remote, ...places].filter((place) => !selected.includes(place)).slice(0, SHOWN);
}

/** «География»: место снимается галочкой, новые находятся по справочнику мест. */
export function GeoEditor({ value, onSave, ...rest }: EditorProps) {
  const id = useId();
  const directory = useGeoDirectory();
  const places = useToggleList(value.geography.selected);
  const [query, setQuery] = useState('');
  const options = optionsFor(query, places.items, directory.ready);
  const add = (place: string) => {
    places.add(place);
    setQuery('');
  };
  const save = () =>
    onSave({ ...value, geography: { ...value.geography, selected: places.checked } });

  return (
    <EditFrame label="География" onSave={save} {...rest}>
      <ToggleChecks list={places} />
      <div className="field">
        <label htmlFor={id}>Город, страна или удалённо</label>
        <input
          id={id}
          type="search"
          value={query}
          placeholder="Например, Казань"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      {directory.failed ? (
        <StatusLine state="err" text="Справочник мест не загрузился. Обновите страницу." />
      ) : null}
      {options.length > 0 ? (
        <ul className="cc-opts" aria-label="Найденные места">
          {options.map((place) => (
            <li key={place}>
              <RowAction icon="plus" onClick={() => add(place)}>
                {place}
              </RowAction>
            </li>
          ))}
        </ul>
      ) : null}
    </EditFrame>
  );
}
