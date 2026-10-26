import { useId, useMemo, useState, type KeyboardEvent, type ReactElement } from 'react';
import { X } from '@phosphor-icons/react';

import { resolveGeoPlace, searchGeoPlaces } from '../../../shared/geo/geoDirectory';
import { useGeoDirectory } from '../geo/useGeoDirectory';

/** Удалённая работа — не место справочника, но выбирается тем же списком. */
const REMOTE_OPTIONS = ['Удалённо из РФ', 'Удалённо из любой страны'] as const;
const REMOTE_QUERY = /^(у|уд|уда|удал|удалё|удале|remote|рем)/iu;
const RESULT_LIMIT = 20;

interface GeoOption {
  readonly value: string;
  readonly label: string;
  readonly context: string;
}

const isRemote = (value: string) => (REMOTE_OPTIONS as readonly string[]).includes(value);

/** Старые значения (свободный текст) — к записи справочника, если она есть. */
export function normalizeGeoSelection(values: readonly string[]): string[] {
  const normalized = values.map((value) =>
    isRemote(value) ? value : (resolveGeoPlace(value)?.value ?? value),
  );
  return [...new Set(normalized)];
}

function optionsFor(query: string, selected: readonly string[]): GeoOption[] {
  const trimmed = query.trim();
  const remote = REMOTE_OPTIONS.filter(() => !trimmed || REMOTE_QUERY.test(trimmed)).map(
    (value) => ({ value, label: value, context: 'формат' }),
  );
  const places = searchGeoPlaces(trimmed, RESULT_LIMIT).map((place) => ({
    value: place.value,
    label: place.label,
    context: place.context,
  }));
  return [...remote, ...places].filter((option) => !selected.includes(option.value));
}

export interface CareerGeoComboboxProps {
  readonly inputId: string;
  readonly selected: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
  /** Enter в пустом поле при закрытом списке — сохранить правку. */
  readonly onSubmit: () => void;
}

function statusText(failed: boolean, ready: boolean, query: string, found: number): string | null {
  if (failed) return 'Справочник мест не загрузился. Обновите страницу.';
  if (!query.trim()) return null;
  if (!ready) return 'Загружаю справочник мест…';
  return found === 0 ? 'Нет такого места в справочнике. Попробуйте другое написание.' : null;
}

function useGeoCombobox({ selected, onChange, onSubmit }: CareerGeoComboboxProps) {
  const { ready, failed } = useGeoDirectory();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const options = useMemo(
    () => (ready || !query.trim() ? optionsFor(query, selected) : []),
    [query, selected, ready],
  );
  const expanded = open && (options.length > 0 || query.trim().length > 0);

  const choose = (option: GeoOption) => {
    onChange([...selected, option.value]);
    setQuery('');
    setActive(-1);
  };

  const move = (step: number) => {
    setOpen(true);
    setActive((index) => (options.length ? (index + step + options.length) % options.length : -1));
  };

  const onEnter = () => {
    const single = query.trim() && options.length === 1 ? options[0] : undefined;
    const option = options[active] ?? single;
    if (expanded && option) choose(option);
    else if (!query.trim()) onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const { key } = event;
    if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter') event.preventDefault();
    if (key === 'ArrowDown') move(1);
    else if (key === 'ArrowUp') move(-1);
    else if (key === 'Enter') onEnter();
    else if (key === 'Escape' && expanded) {
      // Первый Escape закрывает список, второй отменяет правку условия.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    } else if (key === 'Backspace' && !query && selected.length > 0) {
      onChange(selected.slice(0, -1));
    }
  };

  const onQuery = (value: string) => {
    setQuery(value);
    setOpen(true);
    setActive(-1);
  };

  const status = statusText(failed, ready, query, options.length);
  return { query, options, expanded, active, status, choose, onKeyDown, onQuery, setOpen };
}

function GeoChips({
  selected,
  onChange,
}: Pick<CareerGeoComboboxProps, 'selected' | 'onChange'>): ReactElement | null {
  if (selected.length === 0) return null;
  return (
    <ul className="career-geo-chips" aria-label="Выбранные места">
      {selected.map((value) => (
        <li key={value} className="career-geo-chip">
          <span className="career-geo-chip-label">{value}</span>
          <button
            type="button"
            className="career-geo-chip-remove"
            aria-label={`Убрать: ${value}`}
            onClick={() => onChange(selected.filter((item) => item !== value))}
          >
            <X size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function GeoOptions({
  listId,
  options,
  active,
  hidden,
  onChoose,
}: {
  readonly listId: string;
  readonly options: readonly GeoOption[];
  readonly active: number;
  readonly hidden: boolean;
  readonly onChoose: (option: GeoOption) => void;
}): ReactElement {
  return (
    <ul id={listId} role="listbox" className="career-geo-options" hidden={hidden}>
      {options.map((option, index) => (
        // Клавиатура обслуживается полем (aria-activedescendant): опции не получают фокус.
        // eslint-disable-next-line jsx-a11y/click-events-have-key-events
        <li
          key={option.value}
          id={`${listId}-${index}`}
          role="option"
          aria-selected={index === active}
          className="career-geo-option"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(option)}
        >
          <span>{option.label}</span>
          <span className="career-geo-option-context">{option.context}</span>
        </li>
      ))}
    </ul>
  );
}

/** Несколько мест из справочника географии; свободного ввода нет. */
export function CareerGeoCombobox(props: CareerGeoComboboxProps): ReactElement {
  const listId = useId();
  const box = useGeoCombobox(props);
  return (
    <div className="career-geo-combobox">
      <GeoChips selected={props.selected} onChange={props.onChange} />
      <input
        id={props.inputId}
        className="career-inline-input"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={box.expanded}
        aria-controls={listId}
        aria-activedescendant={
          box.expanded && box.active >= 0 ? `${listId}-${box.active}` : undefined
        }
        autoComplete="off"
        value={box.query}
        placeholder="Город, страна или «Удалённо»"
        onFocus={() => box.setOpen(true)}
        onBlur={() => box.setOpen(false)}
        onChange={(event) => box.onQuery(event.target.value)}
        onKeyDown={box.onKeyDown}
      />
      <GeoOptions
        listId={listId}
        options={box.options}
        active={box.active}
        hidden={!box.expanded}
        onChoose={box.choose}
      />
      {box.status ? (
        <p className="career-geo-status" role="status">
          {box.status}
        </p>
      ) : null}
    </div>
  );
}
