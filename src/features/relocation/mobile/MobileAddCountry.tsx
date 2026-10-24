import { useId, useMemo, useState } from 'react';
import { Check, Globe } from '@phosphor-icons/react';
import type { RelocationAddCountryProps } from '../RelocationAddCountry';
import { listRelocationCountries, type RelocationCountry } from '../relocationCountryData';
import { summarizeRelocationCountry } from '../relocationCountrySummary';

/** Mockup 15 `mv=add` at 390: large title, a search row, found countries as .pm-row with «Добавить». */
export function MobileAddCountry({
  profile,
  pinnedCountryCodes,
  onAdd,
  onDone,
}: RelocationAddCountryProps) {
  const [query, setQuery] = useState('');
  const searchId = useId();
  const countries = useMemo(() => listRelocationCountries(), []);
  const needle = query.trim().toLocaleLowerCase('ru');
  const found = needle
    ? countries.filter(({ name }) => name.toLocaleLowerCase('ru').includes(needle))
    : [];
  return (
    <section className="career-relocation-mobile-off" aria-labelledby="career-relocation-add-title">
      <header className="career-relocation-mobile-hero">
        <h2 id="career-relocation-add-title">Добавить страну</h2>
        <p>Поиск среди {countries.length} стран, по которым есть правила.</p>
      </header>
      <label className="career-relocation-mobile-search" htmlFor={searchId}>
        <span>Поиск</span>
        <input
          id={searchId}
          type="search"
          value={query}
          placeholder="Название страны"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {needle ? (
        <FoundCountries
          found={found}
          total={countries.length}
          profile={profile}
          pinnedCountryCodes={pinnedCountryCodes}
          onAdd={onAdd}
        />
      ) : null}
      <p className="career-relocation-mobile-foot">
        Добавленная страна появится в списке. Если правил по ней нет, статус не присваиваем и честно
        говорим, что он не определён.
      </p>
      <button className="career-relocation-mobile-cta" type="button" onClick={onDone}>
        <Check aria-hidden="true" size={18} />
        Готово
      </button>
    </section>
  );
}

function FoundCountries({
  found,
  total,
  profile,
  pinnedCountryCodes,
  onAdd,
}: Pick<RelocationAddCountryProps, 'profile' | 'pinnedCountryCodes' | 'onAdd'> & {
  readonly found: readonly RelocationCountry[];
  readonly total: number;
}) {
  return (
    <div className="career-relocation-mobile-group">
      <h3 className="career-relocation-mobile-cap">
        Найдено {found.length} из {total}
      </h3>
      {found.length ? (
        <ul className="career-relocation-mobile-rows">
          {found.map((country) => (
            <FoundRow
              key={country.countryCode}
              country={country}
              verified={summarizeRelocationCountry(country, profile).scenarios.some(
                ({ sources }) => sources.length > 0,
              )}
              added={pinnedCountryCodes.includes(country.countryCode)}
              onAdd={() => onAdd(country.countryCode)}
            />
          ))}
        </ul>
      ) : (
        <p className="career-relocation-mobile-foot" role="status">
          Такой страны нет в каталоге правил.
        </p>
      )}
    </div>
  );
}

function FoundRow({
  country,
  verified,
  added,
  onAdd,
}: {
  readonly country: RelocationCountry;
  readonly verified: boolean;
  readonly added: boolean;
  readonly onAdd: () => void;
}) {
  return (
    <li>
      <span className="career-relocation-mobile-action-icon">
        <Globe aria-hidden="true" size={18} />
      </span>
      <span>
        <b>{country.name}</b>
        <small>{verified ? 'правила проверены' : 'правил нет: статус не присваиваем'}</small>
      </span>
      <button
        className="career-relocation-mobile-row-action"
        type="button"
        disabled={added}
        onClick={onAdd}
      >
        {added ? 'Добавлена' : 'Добавить'}
      </button>
    </li>
  );
}
