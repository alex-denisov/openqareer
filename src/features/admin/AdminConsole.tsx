import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, MagnifyingGlass } from '@phosphor-icons/react';
import { BrandMark } from '../brand/BrandMark';
import type { AuthUser } from '../coach/coachApi';
import {
  ADMIN_PAGE_SIZE,
  listAdminUsers,
  listAdminVacancySources,
  syncAdminVacancySource,
  impersonateAdminUser,
  type AdminUser,
  type AdminUserPage,
} from './adminApi';
import { AdminVacancySourcesView } from './AdminVacancySourcesView';
import {
  sourcesFailure,
  sourcesLoaded,
  sourcesLoading,
  type VacancySourcesState,
} from './vacancySourcesState';
import { AdminVacanciesView } from './AdminVacanciesView';
import { AdminAuditView } from './AdminAuditView';
import { AdminUserProfileModal } from './AdminUserProfileModal';

interface AdminConsoleProps {
  session?: AuthUser | null;
  sessionPending?: boolean;
}

type DirectoryState =
  | { status: 'loading' }
  | { status: 'ready'; page: AdminUserPage }
  | { status: 'failed'; message: string };

function useVacancySourcesPage() {
  const [state, setState] = useState<VacancySourcesState>(sourcesLoading);

  const load = useCallback(async (signal?: AbortSignal) => {
    setState(sourcesLoading());
    try {
      const data = await listAdminVacancySources(signal);
      if (!signal?.aborted) setState(sourcesLoaded(data));
    } catch (reason: unknown) {
      if (signal?.aborted) return;
      // Отказ маршрута выглядел ровно как честный пустой список: администратор
      // видел «источников нет» и не знал, что запрос не дошёл (B207).
      const failure = sourcesFailure(reason);
      if (failure) setState(failure);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const sync = useCallback(
    async (sourceId: string) => {
      await syncAdminVacancySource(sourceId);
      await load();
    },
    [load],
  );

  return { state, refresh: () => void load(), sync };
}

function AdminNav({
  activeTab,
  onSelectTab,
}: {
  activeTab: 'users' | 'vacancies' | 'sources' | 'audit';
  onSelectTab: (tab: 'users' | 'vacancies' | 'sources' | 'audit') => void;
}) {
  return (
    <nav className="admin-nav" aria-label="Разделы администратора">
      <button
        type="button"
        className={`admin-nav-item ${activeTab === 'users' ? 'is-active' : ''}`}
        onClick={() => onSelectTab('users')}
      >
        👥 Учётные записи
      </button>
      <button
        type="button"
        className={`admin-nav-item ${activeTab === 'vacancies' ? 'is-active' : ''}`}
        onClick={() => onSelectTab('vacancies')}
      >
        💼 База вакансий
      </button>
      <button
        type="button"
        className={`admin-nav-item ${activeTab === 'sources' ? 'is-active' : ''}`}
        onClick={() => onSelectTab('sources')}
      >
        📡 Источники вакансий
      </button>
      <button
        type="button"
        className={`admin-nav-item ${activeTab === 'audit' ? 'is-active' : ''}`}
        onClick={() => onSelectTab('audit')}
      >
        🛡️ Журнал аудита
      </button>
    </nav>
  );
}

function AdminVacancySourcesTab() {
  const { state, refresh, sync } = useVacancySourcesPage();
  return <AdminVacancySourcesView state={state} onRefresh={refresh} onSync={sync} />;
}

function getInitialAdminTab(): 'users' | 'vacancies' | 'sources' | 'audit' {
  if (typeof window === 'undefined') return 'users';
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab === 'vacancies' || tab === 'sources' || tab === 'audit') return tab;
  if (params.get('vacancyId')) return 'vacancies';
  return 'users';
}

export function AdminConsole({ session, sessionPending = false }: AdminConsoleProps) {
  const isAdmin = session?.role === 'admin';
  const [activeTab, setActiveTab] = useState<'users' | 'vacancies' | 'sources' | 'audit'>(getInitialAdminTab);

  useEffect(() => {
    document.title = 'Администрирование · openqareer';
  }, []);

  const handleSelectTab = (tab: 'users' | 'vacancies' | 'sources' | 'audit') => {
    setActiveTab(tab);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (tab === 'users') {
        params.delete('tab');
        params.delete('vacancyId');
      } else {
        params.set('tab', tab);
        if (tab !== 'vacancies') params.delete('vacancyId');
      }
      const query = params.toString();
      const newUrl = query ? `/admin?${query}` : '/admin';
      window.history.replaceState(null, '', newUrl);
    }
  };

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
      <AdminNav activeTab={activeTab} onSelectTab={handleSelectTab} />
      {activeTab === 'users' && <AdminDirectory />}
      {activeTab === 'vacancies' && <AdminVacanciesView />}
      {activeTab === 'sources' && <AdminVacancySourcesTab />}
      {activeTab === 'audit' && <AdminAuditView />}
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
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const { state, load } = useDirectoryPage(submittedQuery, offset);

  return (
    <>
      <AdminDirectoryHeader />
      <AdminSearchForm
        query={query}
        onQueryChange={setQuery}
        onSubmit={() => {
          setOffset(0);
          setSubmittedQuery(query);
        }}
      />
      <AdminDirectoryStatus state={state} onRetry={() => void load()} />
      {state.status === 'ready' && (
        <AdminDirectoryPage
          page={state.page}
          searched={Boolean(submittedQuery)}
          offset={offset}
          selectedId={selectedUser?.id}
          onSelect={setSelectedUser}
          onOffset={setOffset}
        />
      )}
      {selectedUser && (
        <AdminUserProfileModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onUpdated={() => void load()}
        />
      )}
      <p className="admin-scope-note">
        Раздел оператора: управление ролями, тарифами, блокировками, сброс паролей и бесшовная имперсонация сессий.
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
      <div className="admin-head-actions">
        <a className="admin-quiet-link" href="/app">
          В кабинет
        </a>
        <a className="admin-quiet-link" href="/">
          На главную
        </a>
      </div>
    </header>
  );
}

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
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor="admin-query">Поиск по логину, email или имени</label>
      <div>
        <input
          id="admin-query"
          type="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Поиск пользователей…"
          autoComplete="off"
        />
        <button className="admin-btn is-secondary" type="submit">
          <MagnifyingGlass size={16} />
          Найти
        </button>
      </div>
    </form>
  );
}

function AdminTableRowActions({
  user,
  onSelect,
  onImpersonate,
}: {
  user: AdminUser;
  onSelect: (user: AdminUser) => void;
  onImpersonate: (user: AdminUser) => void;
}) {
  return (
    <div className="admin-table-row-actions">
      <button
        className="admin-btn is-secondary"
        type="button"
        onClick={() => onSelect(user)}
        title="Открыть полное управление профилем, тарифом и паролем"
      >
        Управление
      </button>
      <button
        className="admin-btn admin-btn--impersonate"
        type="button"
        onClick={() => onImpersonate(user)}
        title="Войти в кабинет пользователя (имперсонация)"
      >
        Войти
      </button>
    </div>
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
  onOffset: React.Dispatch<React.SetStateAction<number>>;
}) {
  const handleImpersonate = async (user: AdminUser) => {
    if (!window.confirm(`Войти в личный кабинет под именем @${user.username}?`)) return;
    try {
      const res = await impersonateAdminUser(user.id);
      window.location.href = res.redirectUrl || '/app';
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось войти');
    }
  };

  if (page.users.length === 0) {
    return (
      <p className="admin-note">
        {searched ? 'По этому запросу никого не найдено.' : 'В системе пока нет учётных записей.'}
      </p>
    );
  }

  return (
    <>
      <div className="admin-table-container">
        <AdminTable
          users={page.users}
          selectedId={selectedId}
          onSelect={onSelect}
          onImpersonate={handleImpersonate}
        />
      </div>
      <AdminPagination total={page.total} offset={offset} shown={page.users.length} onOffset={onOffset} />
    </>
  );
}

function AdminPagination({
  total,
  offset,
  shown,
  onOffset,
}: {
  total: number;
  offset: number;
  shown: number;
  onOffset: React.Dispatch<React.SetStateAction<number>>;
}) {
  const hasMultiplePages = total > ADMIN_PAGE_SIZE;

  return (
    <nav className="admin-pagination" aria-label="Страницы справочника">
      <button
        className={`admin-quiet-button ${hasMultiplePages ? '' : 'is-hidden'}`}
        type="button"
        disabled={offset === 0}
        onClick={() => onOffset((current) => Math.max(0, current - ADMIN_PAGE_SIZE))}
      >
        <ArrowLeft size={16} />
        Назад
      </button>
      <span className="admin-mono">
        Показано {shown} из {total}
      </span>
      <button
        className={`admin-quiet-button ${hasMultiplePages ? '' : 'is-hidden'}`}
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

function AdminTableRow({
  user,
  isSelected,
  onSelect,
  onImpersonate,
}: {
  user: AdminUser;
  isSelected: boolean;
  onSelect: (user: AdminUser) => void;
  onImpersonate: (user: AdminUser) => void;
}) {
  return (
    <tr className={isSelected ? 'is-selected' : ''}>
      <th scope="row">
        <strong>{user.displayName ?? user.username}</strong>
        <small>{user.email ?? user.username}</small>
      </th>
      <td data-label="Роль:">
        <span className={`admin-badge ${user.role === 'admin' ? 'is-warning' : 'is-muted'}`}>
          {roleLabel(user.role)}
        </span>
      </td>
      <td data-label="Тариф:">
        <span className={`admin-badge admin-badge--${user.subscriptionTier || 'free'}`}>
          {(user.subscriptionTier || 'free').toUpperCase()}
        </span>
        {user.blockedAt && (
          <span className="admin-badge admin-badge--blocked">
            Блок
          </span>
        )}
      </td>
      <td className="admin-mono" data-label="Создан:">
        {formatMoment(user.createdAt)}
      </td>
      <td className="admin-mono" data-label="Активные сессии:">
        {user.activeSessions}
      </td>
      <td>
        <AdminTableRowActions user={user} onSelect={onSelect} onImpersonate={onImpersonate} />
      </td>
    </tr>
  );
}

function AdminTable({
  users,
  selectedId,
  onSelect,
  onImpersonate,
}: {
  users: AdminUser[];
  selectedId?: string;
  onSelect: (user: AdminUser) => void;
  onImpersonate: (user: AdminUser) => void;
}) {
  return (
    <div className="admin-table-scroll">
      <table className="admin-table">
        <caption className="admin-visually-hidden">Учётные записи</caption>
        <thead>
          <tr>
            <th scope="col">Аккаунт</th>
            <th scope="col">Роль</th>
            <th scope="col">Тариф / Статус</th>
            <th scope="col">Создан</th>
            <th scope="col">Сессии</th>
            <th scope="col">Действия</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <AdminTableRow
              key={user.id}
              user={user}
              isSelected={selectedId === user.id}
              onSelect={onSelect}
              onImpersonate={onImpersonate}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AdminFrame({ children }: { children: ReactNode }) {
  return (
    <div className="admin-console">
      <header className="admin-frame-header">
        <a className="admin-brand" href="/" aria-label="openqareer">
          <BrandMark variant="lockup" size={26} />
        </a>
        <div className="admin-frame-actions">
          <a href="/app" className="admin-btn is-secondary">
            В кабинет
          </a>
          <a href="/" className="admin-btn is-secondary">
            На главную
          </a>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}

function useDirectoryPage(query: string, offset: number) {
  const [state, setState] = useState<DirectoryState>({ status: 'loading' });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: 'loading' });
      try {
        const page = await listAdminUsers({ query, offset, signal });
        if (!signal?.aborted) setState({ status: 'ready', page });
      } catch (reason) {
        if (!signal?.aborted) {
          setState({
            status: 'failed',
            message: reason instanceof Error ? reason.message : 'Не удалось загрузить пользователей.',
          });
        }
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
