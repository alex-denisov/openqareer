import { useState } from 'react';
import { B640_CONTACT_SEARCH_MAX } from '../../../../../shared/b640Contacts';
import { ContactFilterBar, ContactChips } from './ContactFilters';
import { ContactSheet } from './ContactSheet';
import { SORT_OPTIONS, type ContactKind } from './contactsFilters';
import type { ContactsState } from './useContacts';

/** Поиск, фильтры, сортировка и чипы выбранного над списком (a02). */
export function ContactsControls({ state }: { readonly state: ContactsState }) {
  const [openKind, setOpenKind] = useState<ContactKind | null>(null);
  const [sheet, setSheet] = useState(false);
  const { criteria, facets, total } = state;
  const onSort = (label: string) => {
    const next = SORT_OPTIONS.find((option) => option.label === label);
    if (next) state.setSort(next.id);
  };
  const pane = { filters: criteria.filters, facets, onChange: state.setFilters };
  return (
    <>
      <div className="ct-ctl">
        <div className="ct-q-wrap">
          <div className="field co-q ct-q">
            <label className="vh" htmlFor="ct-q">
              Поиск по контактам
            </label>
            <input
              id="ct-q"
              type="text"
              inputMode="search"
              placeholder="Имя, компания, должность"
              maxLength={B640_CONTACT_SEARCH_MAX}
              value={state.searchText}
              onChange={(event) => state.setSearchText(event.target.value)}
            />
          </div>
        </div>
        <ContactFilterBar {...pane} total={total} openKind={openKind} onOpenKind={setOpenKind} onOpenSheet={() => setSheet(true)} onReset={state.resetAll} />
        <div className="field co-sort ls-f ct-sort">
          <label className="vh" htmlFor="ct-sort">
            Сортировка
          </label>
          <select id="ct-sort" value={SORT_OPTIONS.find((option) => option.id === criteria.sort)?.label} onChange={(event) => onSort(event.target.value)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.label}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ContactChips filters={criteria.filters} onChange={state.setFilters} onReset={state.resetAll} />
      <ContactSheet {...pane} open={sheet} total={total} sort={criteria.sort} onSort={state.setSort} onClose={() => setSheet(false)} onReset={state.resetAll} />
    </>
  );
}
