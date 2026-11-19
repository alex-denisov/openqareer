import { useState } from 'react';
import { B640_CONTACT_LINKS, B640_CONTACT_STATES, type B640ContactFacets } from '../../../../../shared/b640Contacts';
import { Icon } from '../../kit';
import {
  LINK_LABELS,
  STATE_LABELS,
  toggleValue,
  type ContactFilters,
  type ContactKind,
} from './contactsFilters';

export interface PaneProps {
  readonly filters: ContactFilters;
  readonly facets: B640ContactFacets | null;
  readonly onChange: (filters: ContactFilters) => void;
}

interface Option {
  readonly id: string;
  readonly label: string;
  readonly count: number | undefined;
}

const COMPANY_LIMIT = 100;

function Options({ options, chosen, onToggle }: { options: readonly Option[]; chosen: readonly string[]; onToggle: (id: string) => void }) {
  return (
    <ul className="vt-opts">
      {options.map((option) => (
        <li key={option.id}>
          <label className="vt-opt">
            <input type="checkbox" checked={chosen.includes(option.id)} onChange={() => onToggle(option.id)} />
            <span className="vt-opt-t">{option.label}</span>
            {option.count === undefined ? null : <span className="vt-opt-n num">{option.count}</span>}
          </label>
        </li>
      ))}
    </ul>
  );
}

function CompanyPane({ filters, facets, onChange }: PaneProps) {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const options = (facets?.companies ?? [])
    .filter((entry) => !needle || entry.name.toLocaleLowerCase('ru-RU').includes(needle))
    .slice(0, COMPANY_LIMIT)
    .map((entry) => ({ id: entry.name, label: entry.name, count: entry.count }));
  return (
    <>
      <label className="search">
        <Icon name="search" />
        <span className="vh">Найти компанию</span>
        <input type="search" placeholder="Найти компанию" value={query} onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="vt-pop-list">
        <Options options={options} chosen={filters.company} onToggle={(id) => onChange({ ...filters, company: toggleValue(filters.company, id) })} />
      </div>
    </>
  );
}

function LinkPane({ filters, facets, onChange }: PaneProps) {
  const options = B640_CONTACT_LINKS.map((id) => ({ id, label: LINK_LABELS[id], count: facets?.link[id] }));
  return (
    <div className="vt-pop-list">
      <Options options={options} chosen={filters.link} onToggle={(id) => onChange({ ...filters, link: toggleValue(filters.link, id as (typeof B640_CONTACT_LINKS)[number]) })} />
    </div>
  );
}

function StatusPane({ filters, facets, onChange }: PaneProps) {
  const options = B640_CONTACT_STATES.map((id) => ({ id, label: STATE_LABELS[id], count: facets?.status[id] }));
  return (
    <div className="vt-pop-list">
      <Options options={options} chosen={filters.status} onToggle={(id) => onChange({ ...filters, status: toggleValue(filters.status, id as (typeof B640_CONTACT_STATES)[number]) })} />
    </div>
  );
}

export function ContactPane({ kind, ...props }: PaneProps & { readonly kind: ContactKind }) {
  if (kind === 'company') return <CompanyPane {...props} />;
  if (kind === 'link') return <LinkPane {...props} />;
  return <StatusPane {...props} />;
}
