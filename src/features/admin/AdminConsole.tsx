import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Briefcase,
  Broadcast,
  LinkedinLogo,
  MagnifyingGlass,
  GearSix,
  SignIn,
  ShieldCheck,
  UsersThree,
} from '@phosphor-icons/react';
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
import { HhCrawlFilterView } from './HhCrawlFilterView';
import { getHhCrawlFilter, type HhCrawlFilter } from './adminApi';
import {
  sourcesFailure,
  sourcesLoaded,
  sourcesLoading,
  type VacancySourcesState,
} from './vacancySourcesState';
import { AdminVacanciesView } from './AdminVacanciesView';
import { AdminAuditView } from './AdminAuditView';
import { AdminUserProfileModal } from './AdminUserProfileModal';
import { AdminLinkedinPoolView } from './AdminLinkedinPoolView';
import { roleCan } from '../../../shared/roleMatrix';

interface AdminConsoleProps {
  session?: AuthUser | null;
  sessionPending?: boolean;
  onUnauthorized?: () => void;
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
      const data = await listAdminVacancySources(signal, (sources) => {
        if (!signal?.aborted) setState(sourcesLoaded(sources, false));
      });
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
  activeTab: 'users' | 'vacancies' | 'sources' | 'audit' | 'linkedin';
  onSelectTab: (tab: 'users' | 'vacancies' | 'sources' | 'audit' | 'linkedin') => void;
}) {
  return (
    <nav className="admin-nav" aria-label="Разделы администратора">
      <p className="admin-nav-label">Разделы</p>
      <button
        type="button"
        className={`admin-nav-item ${activeTab === 'users' ? 'is-active' : ''}`}
        onClick={() => onSelectTab('users')}
      >
        <UsersThree size={16} aria-hidden="true" /> Учётные записи
      </button>
      <button
        type="button"
        className={`admin-nav-item ${activeTab === 'vacancies' ? 'is-active' : ''}`}
        onClick={() => onSelectTab('vacancies')}
      >
        <Briefcase size={16} aria-hidden="true" /> База вакансий
      </button>
      <button
        type="button"
        className={`admin-nav-item ${activeTab === 'sources' ? 'is-active' : ''}`}
        onClick={() => onSelectTab('sources')}
      >
        <Broadcast size={16} aria-hidden="true" /> Источники вакансий
      </button>
      <button
        type="button"
        className={`admin-nav-item ${activeTab === 'audit' ? 'is-active' : ''}`}
        onClick={() => onSelectTab('audit')}
      >
        <ShieldCheck size={16} aria-hidden="true" /> Журнал аудита
      </button>
      <button
        type="button"
        className={`admin-nav-item ${activeTab === 'linkedin' ? 'is-active' : ''}`}
        onClick={() => onSelectTab('linkedin')}
      >
        <LinkedinLogo size={16} aria-hidden="true" /> Аккаунты LinkedIn
      </button>
    </nav>
  );
}

/**
 * Справочник ролей площадки для фильтра обхода. Недоступный фильтр оставляет
 * экран источников рабочим: это настройка одной площадки, а не условие показа
 * всего списка (B214).
 */
function useHhCrawlFilter(): HhCrawlFilter | null {
  const [filter, setFilter] = useState<HhCrawlFilter | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getHhCrawlFilter(controller.signal)
      .then(setFilter)
      .catch(() => setFilter(null));
    return () => controller.abort();
  }, []);

  return filter;
}

function shouldShowHhCrawlFilter(state: VacancySourcesState): boolean {
  return (
    state.status === 'ready' &&
    state.sources.some((source) => source.id === 'hh' || source.type === 'hh')
  );
}

function AdminVacancySourcesTab() {
  const { state, refresh, sync } = useVacancySourcesPage();
  // Фильтр обхода hh.ru стоит рядом с источниками: он и есть настройка одного
  // из них, и искать его в отдельной вкладке владельцу незачем (B214).
  const crawlFilter = useHhCrawlFilter();
  const showHhFilter = shouldShowHhCrawlFilter(state);

  return (
    <>
      <AdminVacancySourcesView state={state} onRefresh={refresh} onSync={sync} />
      {showHhFilter ? <HhCrawlFilterView filter={crawlFilter} /> : null}
    </>
  );
}

function getInitialAdminTab(): 'users' | 'vacancies' | 'sources' | 'audit' | 'linkedin' {
  if (typeof window === 'undefined') return 'users';
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (tab === 'vacancies' || tab === 'sources' || tab === 'audit' || tab === 'linkedin') return tab;
  if (params.get('vacancyId')) return 'vacancies';
  return 'users';
}

// eslint-disable-next-line max-lines-per-function -- the console owns tab routing and role boundary in one shell
export function AdminConsole({
  session,
  sessionPending = false,
  onUnauthorized,
}: AdminConsoleProps) {
  const isAdmin = session ? roleCan(session.role, 'admin.console') : false;
  const [activeTab, setActiveTab] = useState<
    'users' | 'vacancies' | 'sources' | 'audit' | 'linkedin'
  >(getInitialAdminTab);

  useEffect(() => {
    document.title = 'Администрирование · openqareer';
  }, []);

  useEffect(() => {
    if (!sessionPending && !isAdmin) onUnauthorized?.();
  }, [isAdmin, onUnauthorized, sessionPending]);

  const handleSelectTab = (tab: 'users' | 'vacancies' | 'sources' | 'audit' | 'linkedin') => {
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

  if (!isAdmin) {
    if (onUnauthorized) return null;
    return <AdminRefusal signedIn={Boolean(session)} />;
  }

  return (
    <AdminFrame>
      <div className="admin-layout">
        <AdminNav activeTab={activeTab} onSelectTab={handleSelectTab} />
        <div className="admin-workspace">
          {activeTab === 'users' && <AdminDirectory />}
          {activeTab === 'vacancies' && <AdminVacanciesView />}
          {activeTab === 'sources' && <AdminVacancySourcesTab />}
          {activeTab === 'audit' && <AdminAuditView />}
          {activeTab === 'linkedin' && <AdminLinkedinPoolView />}
        </div>
      </div>
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

// eslint-disable-next-line max-lines-per-function -- directory filters, sorting and modal state form one screen
function AdminDirectory() {
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [searchField, setSearchField] = useState<'all' | 'username' | 'email' | 'displayName'>('all');
  const [offset, setOffset] = useState(0);
  const [role, setRole] = useState<'all' | 'candidate' | 'admin'>('all');
  const [tier, setTier] = useState<'all' | 'free' | 'pro' | 'executive' | 'enterprise'>('all');
  const [blocked, setBlocked] = useState<'all' | 'yes' | 'no'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'role' | 'tier' | 'created' | 'sessions'>('created');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const { state, load } = useDirectoryPage({
    query: submittedQuery, searchField, offset, role, tier, blocked, sortBy, sortDirection,
  });
  const changeSort = (column: typeof sortBy) => {
    setOffset(0);
    setSortDirection((current) => column === sortBy ? (current === 'asc' ? 'desc' : 'asc') : 'asc');
    setSortBy(column);
  };

  return (
    <>
      <AdminDirectoryHeader />
      <AdminSearchForm
        query={query}
        onQueryChange={setQuery}
        searchField={searchField}
        onSearchFieldChange={(field) => { setSearchField(field); setOffset(0); }}
        onSubmit={() => {
          setOffset(0);
          setSubmittedQuery(query);
        }}
      />
      <div className="admin-directory-filters" aria-label="Фильтры учётных записей">
        <label>Роль
          <select value={role} onChange={(event) => { setRole(event.target.value as typeof role); setOffset(0); }}>
            <option value="all">Все роли</option><option value="candidate">Кандидаты</option><option value="admin">Администраторы</option>
          </select>
        </label>
        <label>Тариф
          <select value={tier} onChange={(event) => { setTier(event.target.value as typeof tier); setOffset(0); }}>
            <option value="all">Все тарифы</option><option value="free">Free</option><option value="pro">Pro</option>
            <option value="executive">Executive</option><option value="enterprise">Enterprise</option>
          </select>
        </label>
        <label>Блокировка
          <select value={blocked} onChange={(event) => { setBlocked(event.target.value as typeof blocked); setOffset(0); }}>
            <option value="all">Все</option><option value="yes">Заблокированы</option><option value="no">Активны</option>
          </select>
        </label>
      </div>
      <div className="admin-directory-sort-mobile admin-register-chips" aria-label="Сортировка учётных записей">
        {([['name', 'Имя'], ['role', 'Роль'], ['tier', 'Тариф'], ['created', 'Создан'], ['sessions', 'Сессии']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={sortBy === value} onClick={() => changeSort(value)}>{label}{sortBy === value ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}</button>
        ))}
      </div>
      <AdminDirectoryStatus state={state} onRetry={() => void load()} />
      {state.status === 'ready' && (
        <AdminDirectoryPage
          page={state.page}
          searched={Boolean(submittedQuery)}
          offset={offset}
          selectedId={selectedUser?.id}
          onSelect={setSelectedUser}
          onOffset={setOffset}
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSort={changeSort}
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
        Раздел оператора: управление ролями, тарифами, блокировками, сбросом паролей и входом в
        кабинет пользователя.
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
        <p className="admin-note">Поиск, доступ и состояние пользователей.</p>
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
  searchField,
  onSearchFieldChange,
  onSubmit,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  searchField: 'all' | 'username' | 'email' | 'displayName';
  onSearchFieldChange: (value: 'all' | 'username' | 'email' | 'displayName') => void;
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
      <div className="admin-register-chips" aria-label="Поле поиска">
        {([['all', 'Везде'], ['username', 'Логин'], ['email', 'Email'], ['displayName', 'Имя']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={searchField === value} onClick={() => onSearchFieldChange(value)}>{label}</button>
        ))}
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
        className="admin-btn admin-icon-btn is-secondary"
        type="button"
        onClick={() => onSelect(user)}
        aria-label={`Управление аккаунтом ${user.username}`}
        title="Управление аккаунтом"
      >
        <GearSix size={18} aria-hidden="true" />
      </button>
      <button
        className="admin-btn admin-btn--impersonate"
        type="button"
        onClick={() => onImpersonate(user)}
        title="Войти в кабинет пользователя (имперсонация)"
      >
        <SignIn size={18} aria-hidden="true" /> Войти
      </button>
    </div>
  );
}

// eslint-disable-next-line max-lines-per-function -- page owns the exact row actions and pagination
function AdminDirectoryPage({
  page,
  searched,
  offset,
  selectedId,
  onSelect,
  onOffset,
  sortBy,
  sortDirection,
  onSort,
}: {
  page: AdminUserPage;
  searched: boolean;
  offset: number;
  selectedId?: string;
  onSelect: (user: AdminUser) => void;
  onOffset: React.Dispatch<React.SetStateAction<number>>;
  sortBy: 'name' | 'role' | 'tier' | 'created' | 'sessions';
  sortDirection: 'asc' | 'desc';
  onSort: (column: 'name' | 'role' | 'tier' | 'created' | 'sessions') => void;
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
          sortBy={sortBy}
          sortDirection={sortDirection}
          onSort={onSort}
        />
      </div>
      <AdminPagination
        total={page.total}
        offset={offset}
        shown={page.users.length}
        onOffset={onOffset}
      />
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
        {user.blockedAt && <span className="admin-badge admin-badge--blocked">Блок</span>}
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

// eslint-disable-next-line max-lines-per-function -- sortable table headings and rows stay in one semantic table
function AdminTable({
  users,
  selectedId,
  onSelect,
  onImpersonate,
  sortBy,
  sortDirection,
  onSort,
}: {
  users: AdminUser[];
  selectedId?: string;
  onSelect: (user: AdminUser) => void;
  onImpersonate: (user: AdminUser) => void;
  sortBy: 'name' | 'role' | 'tier' | 'created' | 'sessions';
  sortDirection: 'asc' | 'desc';
  onSort: (column: 'name' | 'role' | 'tier' | 'created' | 'sessions') => void;
}) {
  const heading = (column: typeof sortBy, label: string) => (
    <th scope="col" aria-sort={sortBy === column ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="admin-column-sort" type="button" onClick={() => onSort(column)}>
        {label}<span aria-hidden="true">{sortBy === column ? (sortDirection === 'asc' ? ' ↑' : ' ↓') : ''}</span>
      </button>
    </th>
  );
  return (
    <div className="admin-table-scroll">
      <table className="admin-table admin-user-table">
        <caption className="admin-visually-hidden">Учётные записи</caption>
        <thead>
          <tr>
            {heading('name', 'Аккаунт')}
            {heading('role', 'Роль')}
            {heading('tier', 'Тариф / Статус')}
            {heading('created', 'Создан')}
            {heading('sessions', 'Сессии')}
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
        <span className="admin-frame-title">Панель управления</span>
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

function useDirectoryPage(input: {
  query: string;
  searchField: 'all' | 'username' | 'email' | 'displayName';
  offset: number;
  role: 'all' | 'candidate' | 'admin';
  tier: 'all' | 'free' | 'pro' | 'executive' | 'enterprise';
  blocked: 'all' | 'yes' | 'no';
  sortBy: 'name' | 'role' | 'tier' | 'created' | 'sessions';
  sortDirection: 'asc' | 'desc';
}) {
  const [state, setState] = useState<DirectoryState>({ status: 'loading' });
  const { query, searchField, offset, role, tier, blocked, sortBy, sortDirection } = input;

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setState({ status: 'loading' });
      try {
        const page = await listAdminUsers({
          query, searchField, offset, signal,
          ...(role === 'all' ? {} : { role }),
          ...(tier === 'all' ? {} : { tier }),
          ...(blocked === 'all' ? {} : { blocked: blocked === 'yes' }),
          sortBy, sortDirection,
        });
        if (!signal?.aborted) setState({ status: 'ready', page });
      } catch (reason) {
        if (!signal?.aborted) {
          setState({
            status: 'failed',
            message:
              reason instanceof Error ? reason.message : 'Не удалось загрузить пользователей.',
          });
        }
      }
    },
    [blocked, offset, query, role, searchField, sortBy, sortDirection, tier],
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
