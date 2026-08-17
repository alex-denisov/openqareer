import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, MagnifyingGlass } from '@phosphor-icons/react';
import { BrandMark } from '../brand/BrandMark';
import type { AuthUser } from '../coach/coachApi';
import { ADMIN_PAGE_SIZE, listAdminUsers, type AdminUser, type AdminUserPage } from './adminApi';

interface AdminConsoleProps {
  session?: AuthUser | null;
  sessionPending?: boolean;
}

type DirectoryState =
  | { status: 'loading' }
  | { status: 'ready'; page: AdminUserPage }
  | { status: 'failed'; message: string };

/**
 * B089, first slice — the administrator can sign in and see who is in the
 * system. Management actions (role, block, password reset, deletion) and the
 * audit trail follow in the next slice; this screen deliberately shows only
 * what it can prove, and says so on the screen itself.
 */
export function AdminConsole({ session, sessionPending = false }: AdminConsoleProps) {
  const isAdmin = session?.role === 'admin';

  useEffect(() => {
    document.title = 'Администрирование · openqareer';
  }, []);

  if (sessionPending) {
    return (
      <AdminFrame>
        <p className="admin-note" aria-busy="true">
          Проверяем сессию…
        </p>
      </AdminFrame>
    );
  }

  if (!isAdmin) return <AdminRefusal signedIn={Boolean(session)} />;

  return (
    <AdminFrame>
      <AdminDirectory />
    </AdminFrame>
  );
}

function AdminRefusal({ signedIn }: { signedIn: boolean }) {
  return (
    <AdminFrame>
      <h1>Раздел администратора</h1>
      <p className="admin-note">
        {signedIn
          ? 'Этот аккаунт не администратор. Раздел открыт только учётным записям с ролью администратора.'
          : 'Нужен вход под учётной записью администратора. Вход открывается в кабинете.'}
      </p>
      <a className="admin-primary-link" href="/">
        Вернуться в кабинет
      </a>
    </AdminFrame>
  );
}

function AdminDirectory() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<AdminUser>();
  const { state, load } = useDirectoryPage(submittedQuery, offset);

  return (
    <>
      <AdminDirectoryHeader />

      <AdminSearchForm
        query={query}
        onQueryChange={setQuery}
        onSubmit={() => {
          setOffset(0);
          setSelected(undefined);
          setSubmittedQuery(query);
        }}
      />

      <AdminDirectoryStatus state={state} onRetry={() => void load()} />

      {state.status === 'ready' ? (
        <AdminDirectoryPage
          page={state.page}
          searched={Boolean(submittedQuery)}
          offset={offset}
          selectedId={selected?.id}
          onSelect={setSelected}
          onOffset={setOffset}
        />
      ) : null}

      {selected ? <AdminUserCard user={selected} onClose={() => setSelected(undefined)} /> : null}

      <p className="admin-scope-note">
        Раздел показывает только учётные данные аккаунта: логин, email, роль и активность сессий.
        Переписка, документы и карьерные данные кандидата здесь не открываются. Управление ролями,
        блокировка, сброс пароля, удаление и журнал действий добавляются следующим срезом B089.
      </p>
    </>
  );
}

function AdminDirectoryHeader() {
  return (
    <header className="admin-head">
      <div>
        <p className="admin-eyebrow">Администрирование</p>
        <h1>Учётные записи</h1>
      </div>
      <a className="admin-quiet-link" href="/">
        В кабинет
      </a>
    </header>
  );
}

/** A directory that is loading or broken says so; it never shows a blank page. */
function AdminDirectoryStatus({ state, onRetry }: { state: DirectoryState; onRetry: () => void }) {
  if (state.status === 'failed') {
    return (
      <div className="admin-error" role="alert">
        <p>{state.message}</p>
        <button className="admin-quiet-button" type="button" onClick={onRetry}>
          Повторить
        </button>
      </div>
    );
  }
  if (state.status === 'loading') {
    return (
      <p className="admin-note" aria-busy="true">
        Загружаем список…
      </p>
    );
  }
  return null;
}

/**
 * One request per query/page, cancelled when either changes, so a slow earlier
 * page can never overwrite the page the administrator is actually looking at.
 */
function useDirectoryPage(query: string, offset: number) {
  const [state, setState] = useState<DirectoryState>({ status: 'loading' });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: 'loading' });
      try {
        const page = await listAdminUsers({
          ...(query ? { query } : {}),
          offset,
          ...(signal ? { signal } : {}),
        });
        if (!signal?.aborted) setState({ status: 'ready', page });
      } catch (reason) {
        if (signal?.aborted) return;
        setState({
          status: 'failed',
          message:
            reason instanceof Error ? reason.message : 'Не удалось загрузить список аккаунтов.',
        });
      }
    },
    [offset, query],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { state, load };
}

function AdminSearchForm({
  query,
  onQueryChange,
  onSubmit,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className="admin-search"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="admin-search-field">Поиск по логину, email или имени</label>
      <div>
        <input
          id="admin-search-field"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="например, maria@example.com"
          maxLength={80}
        />
        <button className="admin-primary-button" type="submit">
          <MagnifyingGlass size={16} weight="bold" />
          Найти
        </button>
      </div>
    </form>
  );
}

function AdminDirectoryPage({
  page,
  searched,
  offset,
  selectedId,
  onSelect,
  onOffset,
}: {
  page: AdminUserPage;
  searched: boolean;
  offset: number;
  selectedId?: string;
  onSelect: (user: AdminUser) => void;
  onOffset: (next: (current: number) => number) => void;
}) {
  const shown = page.users.length;
  return (
    <>
      <p className="admin-count">
        {page.total === 0
          ? searched
            ? 'Ни одна учётная запись не подошла под запрос.'
            : 'В системе пока нет учётных записей.'
          : `Показано ${shown} из ${page.total}`}
      </p>

      {page.total > 0 ? (
        <AdminTable users={page.users} selectedId={selectedId} onSelect={onSelect} />
      ) : null}

      {page.total > ADMIN_PAGE_SIZE ? (
        <AdminPager total={page.total} shown={shown} offset={offset} onOffset={onOffset} />
      ) : null}
    </>
  );
}

function AdminPager({
  total,
  shown,
  offset,
  onOffset,
}: {
  total: number;
  shown: number;
  offset: number;
  onOffset: (next: (current: number) => number) => void;
}) {
  return (
    <nav className="admin-pager" aria-label="Страницы списка">
      <button
        className="admin-quiet-button"
        type="button"
        disabled={offset === 0}
        onClick={() => onOffset((current) => Math.max(0, current - ADMIN_PAGE_SIZE))}
      >
        <ArrowLeft size={16} />
        Назад
      </button>
      <span className="admin-mono">
        {offset + 1}–{offset + shown} из {total}
      </span>
      <button
        className="admin-quiet-button"
        type="button"
        disabled={offset + shown >= total}
        onClick={() => onOffset((current) => current + ADMIN_PAGE_SIZE)}
      >
        Далее
        <ArrowRight size={16} />
      </button>
    </nav>
  );
}

function AdminTable({
  users,
  selectedId,
  onSelect,
}: {
  users: AdminUser[];
  selectedId?: string;
  onSelect: (user: AdminUser) => void;
}) {
  return (
    <div className="admin-table-scroll">
      <table className="admin-table">
        <caption className="admin-visually-hidden">Учётные записи</caption>
        <thead>
          <tr>
            <th scope="col">Аккаунт</th>
            <th scope="col">Роль</th>
            <th scope="col">Создан</th>
            <th scope="col">Активные сессии</th>
            <th scope="col"> </th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} className={selectedId === user.id ? 'is-selected' : ''}>
              <th scope="row">
                <strong>{user.displayName ?? user.username}</strong>
                <small>{user.email ?? user.username}</small>
              </th>
              <td data-label="Роль:">{roleLabel(user.role)}</td>
              <td className="admin-mono" data-label="Создан:">
                {formatMoment(user.createdAt)}
              </td>
              <td className="admin-mono" data-label="Активные сессии:">
                {user.activeSessions}
              </td>
              <td>
                <button className="admin-quiet-button" type="button" onClick={() => onSelect(user)}>
                  Карточка
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminUserCard({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  return (
    <section className="admin-card" aria-label={`Карточка: ${user.displayName ?? user.username}`}>
      <header>
        <h2>{user.displayName ?? user.username}</h2>
        <button className="admin-quiet-button" type="button" onClick={onClose}>
          Закрыть
        </button>
      </header>
      <dl>
        <Row label="Логин" value={user.username} mono />
        <Row label="Email" value={user.email ?? 'Не указан'} />
        <Row label="Роль" value={roleLabel(user.role)} />
        <Row label="Тестовый аккаунт" value={user.isTest ? 'Да' : 'Нет'} />
        <Row label="Идентификатор кандидата" value={user.candidateId ?? '—'} mono />
        <Row label="Создан" value={formatMoment(user.createdAt)} mono />
        <Row
          label="Последняя активность"
          value={user.lastSeenAt ? formatMoment(user.lastSeenAt) : 'Не входил'}
          mono
        />
        <Row label="Активные сессии" value={String(user.activeSessions)} mono />
      </dl>
    </section>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={mono ? 'admin-mono' : undefined}>{value}</dd>
    </div>
  );
}

function AdminFrame({ children }: { children: ReactNode }) {
  return (
    <div className="admin-console">
      <a className="admin-brand" href="/" aria-label="openqareer">
        <BrandMark variant="lockup" size={24} />
      </a>
      <main>{children}</main>
    </div>
  );
}

function roleLabel(role: AdminUser['role']) {
  return role === 'admin' ? 'Администратор' : 'Кандидат';
}

function formatMoment(value: string) {
  const moment = new Date(value);
  if (Number.isNaN(moment.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(moment);
}
