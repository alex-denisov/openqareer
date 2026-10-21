import { useMemo, useState } from 'react';
import { ArrowRight, Check, Info, Plus } from '@phosphor-icons/react';
import type { RelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { listRelocationCountries } from './relocationCountryData';
import { summarizeRelocationCountry } from './relocationCountrySummary';

export interface RelocationAddCountryProps {
  readonly profile: RelocationQuestionnaire | null;
  readonly pinnedCountryCodes: readonly string[];
  readonly onAdd: (countryCode: string) => void;
  readonly onDone: () => void;
}

/** Mockup 15 `view=add` / `mv=add`: search the rules catalog and pin a country to the list. */
export function RelocationAddCountry({ profile, pinnedCountryCodes, onAdd, onDone }: RelocationAddCountryProps) {
  const [query, setQuery] = useState('');
  const [explained, setExplained] = useState(false);
  const countries = useMemo(() => listRelocationCountries(), []);
  const needle = query.trim().toLocaleLowerCase('ru');
  const found = needle ? countries.filter(({ name }) => name.toLocaleLowerCase('ru').includes(needle)) : [];
  return (
    <section className="career-relocation-card career-relocation-add" aria-labelledby="career-relocation-add-title">
      <div className="career-relocation-section-title">
        <h3 id="career-relocation-add-title">Добавить страну</h3>
        <button className="career-relocation-icon-button" type="button" aria-label="Пояснение" aria-expanded={explained} onClick={() => setExplained((current) => !current)}>
          <Info aria-hidden="true" size={17} />
        </button>
      </div>
      {explained ? (
        <p className="career-relocation-muted">Страна попадёт в ваш список. Статус присваивается только по проверенным правилам; без них страна останется «нужно уточнить».</p>
      ) : null}
      <label className="career-relocation-search">
        <span>Поиск страны</span>
        <input type="search" value={query} placeholder="Начните вводить название" onChange={(event) => setQuery(event.target.value)} />
      </label>
      {needle ? <h4 className="career-relocation-muted">Найдено {found.length} из {countries.length}</h4> : null}
      {needle && !found.length ? <p role="status">Такой страны нет в каталоге правил.</p> : null}
      <ul className="career-relocation-add-list">
        {found.map((country) => {
          const summary = summarizeRelocationCountry(country, profile);
          const added = pinnedCountryCodes.includes(country.countryCode);
          const verified = summary.scenarios.some(({ sources }) => sources.length > 0);
          return (
            <li key={country.countryCode}>
              <span>
                <strong>{country.name}</strong>
                <span>{verified ? `правила проверены: ${summary.statusLabel.toLocaleLowerCase('ru')}` : 'правил нет: статус не присваиваем'}</span>
              </span>
              <button className="career-btn career-btn-secondary" type="button" disabled={added} onClick={() => onAdd(country.countryCode)}>
                {added ? <><Check aria-hidden="true" size={16} />Добавлена</> : <><Plus aria-hidden="true" size={16} />Добавить</>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="career-relocation-footer-actions">
        <button className="career-btn career-btn-primary" type="button" onClick={onDone}>
          <ArrowRight aria-hidden="true" size={17} />Готово
        </button>
      </div>
    </section>
  );
}
