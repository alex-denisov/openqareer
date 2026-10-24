import { useId, useMemo, useState } from 'react';
import { Check, Info, MagnifyingGlass, Plus } from '@phosphor-icons/react';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { listRelocationCountries, type RelocationCountry } from './relocationCountryData';
import { summarizeRelocationCountry } from './relocationCountrySummary';

export interface RelocationAddCountryProps {
  readonly profile: RelocationQuestionnaire | null;
  readonly pinnedCountryCodes: readonly string[];
  readonly onAdd: (countryCode: string) => void;
  readonly onDone: () => void;
}

/** Mockup 15 `view=add` / `mv=add`: search the rules catalog and pin a country to the list. */
export function RelocationAddCountry({
  profile,
  pinnedCountryCodes,
  onAdd,
  onDone,
}: RelocationAddCountryProps) {
  const [query, setQuery] = useState('');
  const countries = useMemo(() => listRelocationCountries(), []);
  const needle = query.trim().toLocaleLowerCase('ru');
  const found = needle
    ? countries.filter(({ name }) => name.toLocaleLowerCase('ru').includes(needle))
    : [];
  return (
    <section
      className="career-relocation-card career-relocation-add"
      aria-labelledby="career-relocation-add-title"
    >
      <AddCountryHeading />
      <CountrySearch query={query} onChange={setQuery} />
      {needle ? (
        <p className="career-relocation-add-found">
          Найдено {found.length} из {countries.length}
        </p>
      ) : null}
      {needle && !found.length ? <p role="status">Такой страны нет в каталоге правил.</p> : null}
      <ul className="career-relocation-add-list">
        {found.map((country) => (
          <AddCountryRow
            key={country.countryCode}
            country={country}
            profile={profile}
            added={pinnedCountryCodes.includes(country.countryCode)}
            onAdd={onAdd}
          />
        ))}
      </ul>
      <AddCountryNote />
      <div className="career-relocation-footer-actions">
        <button className="career-relocation-btn is-primary" type="button" onClick={onDone}>
          <Check aria-hidden="true" size={17} />
          Готово
        </button>
      </div>
    </section>
  );
}

function AddCountryNote() {
  return (
    <p className="career-relocation-note">
      <Info aria-hidden="true" size={17} />
      <span>
        Добавленная страна появится в списке. Если правил по ней нет, статус не присваиваем и честно
        говорим, что он не определён.
      </span>
    </p>
  );
}

function AddCountryHeading() {
  const [explained, setExplained] = useState(false);
  return (
    <>
      <div className="career-relocation-section-title">
        <h3 id="career-relocation-add-title">Добавить страну</h3>
        <button
          className="career-relocation-btn is-sm is-icon is-ghost"
          type="button"
          aria-label="Пояснение"
          aria-expanded={explained}
          onClick={() => setExplained((current) => !current)}
        >
          <Info aria-hidden="true" size={17} />
        </button>
      </div>
      {explained ? (
        <p className="career-relocation-muted">
          Страна попадёт в ваш список. Статус присваивается только по проверенным правилам; без них
          страна останется «нужно уточнить».
        </p>
      ) : null}
    </>
  );
}

function AddCountryRow({
  country,
  profile,
  added,
  onAdd,
}: {
  readonly country: RelocationCountry;
  readonly profile: RelocationQuestionnaire | null;
  readonly added: boolean;
  readonly onAdd: (countryCode: string) => void;
}) {
  const summary = summarizeRelocationCountry(country, profile);
  const verified = summary.scenarios.some(({ sources }) => sources.length > 0);
  return (
    <li>
      <span>
        <strong>{country.name}</strong>
        <span>
          {verified
            ? `Правила проверены: ${summary.statusLabel.toLocaleLowerCase('ru')}`
            : 'Правил нет: статус не присваиваем'}
        </span>
      </span>
      <span className="career-relocation-add-row-actions">
        <span
          className={`career-relocation-country-status ${verified ? 'is-available' : 'is-unknown'}`}
        >
          {verified ? 'Можно добавить' : 'Нет данных'}
        </span>
        <AddButton added={added} onAdd={() => onAdd(country.countryCode)} />
      </span>
    </li>
  );
}

function AddButton({ added, onAdd }: { readonly added: boolean; readonly onAdd: () => void }) {
  return (
    <button
      className="career-relocation-btn is-sm is-ghost"
      type="button"
      disabled={added}
      onClick={onAdd}
    >
      {added ? <Check aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={16} />}
      {added ? 'Добавлена' : 'Добавить'}
    </button>
  );
}

function CountrySearch({
  query,
  onChange,
}: {
  readonly query: string;
  readonly onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="career-relocation-search">
      <label htmlFor={id}>Поиск страны</label>
      <span className="career-relocation-search-box">
        <MagnifyingGlass aria-hidden="true" size={20} />
        <input
          id={id}
          type="search"
          value={query}
          placeholder="Начните вводить название"
          onChange={(event) => onChange(event.target.value)}
        />
      </span>
    </div>
  );
}
