import { MagnifyingGlass } from '@phosphor-icons/react';

type AdminSearchField = 'all' | 'username' | 'email' | 'displayName';

export function AdminSearchForm({
  query,
  onQueryChange,
  searchField,
  onSearchFieldChange,
  onSubmit,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  searchField: AdminSearchField;
  onSearchFieldChange: (value: AdminSearchField) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="admin-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="admin-query">Поиск по логину, email или имени</label>
      <AdminSearchInput query={query} onChange={onQueryChange} />
      <AdminSearchFieldChips field={searchField} onChange={onSearchFieldChange} />
    </form>
  );
}

function AdminSearchInput({
  query,
  onChange,
}: {
  query: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <input
        id="admin-query"
        type="search"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Поиск пользователей…"
        autoComplete="off"
      />
      <button className="admin-btn is-secondary" type="submit">
        <MagnifyingGlass size={16} />
        Найти
      </button>
    </div>
  );
}

function AdminSearchFieldChips({
  field,
  onChange,
}: {
  field: AdminSearchField;
  onChange: (value: AdminSearchField) => void;
}) {
  const fields: ReadonlyArray<[AdminSearchField, string]> = [
    ['all', 'Везде'],
    ['username', 'Логин'],
    ['email', 'Email'],
    ['displayName', 'Имя'],
  ];
  return (
    <div className="admin-register-chips" aria-label="Поле поиска">
      {fields.map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-pressed={field === value}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
