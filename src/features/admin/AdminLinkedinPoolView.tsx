import { useCallback, useEffect, useRef, useState } from 'react';
import { useEscapeLayer } from '../shell/escapeLayers';
import {
  ArrowClockwise,
  Browser,
  CaretDown,
  Desktop,
  LinkBreak,
  LinkedinLogo,
  Plus,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { apiErrorMessage } from '../coach/apiClient';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import {
  clearPoolSessionProfile,
  closeConnectorSession,
  exportPoolSessionCookies,
  managedLinkedinSessionLayout,
  openManagedLinkedinSession,
  resizeConnectorSession,
} from '../connections/connectorSession';
import {
  adminRouteFailureCopy,
  endAdminLinkedinRoute,
  startAdminLinkedinRoute,
  transferFailureCopy,
  useAdminLinkedinLoginPolling,
  type ActiveLinkedinLogin,
} from './adminLinkedinSessionFlow';
import {
  AdminLinkedinServerSessionActions,
  AdminLinkedinServerSessionMeta,
} from './AdminLinkedinServerSessionControls';
import {
  completeAdminLinkedinLogin,
  createAdminLinkedinAccount,
  deleteAdminLinkedinSession,
  deleteAdminLinkedinAccount,
  listAdminLinkedinAccounts,
  requestAdminLinkedinLogin,
  revokeAdminLinkedinAccount,
  storeAdminLinkedinSession,
  type LinkedinPoolAccount,
  type LinkedinSessionState,
} from './linkedinPoolApi';
import { TimezoneSelect } from '../shell/TimezoneSelect';
import { AdminLinkedinRemoteLoginPanel } from './AdminLinkedinRemoteLoginPanel';
import { useRemoteLoginLauncher } from './useRemoteLoginLauncher';
import { adminLinkedinFailureCopy } from './linkedinPoolStatusCopy';
import {
  DEFAULT_ACCOUNT_TIMEZONE,
  formatTimezoneDisplay,
} from '../../../shared/timezoneUtils';

export { isSafeAdminLinkedinSessionPage } from './adminLinkedinSessionFlow';

type PoolViewState =
  | { status: 'loading' }
  | { status: 'ready'; accounts: LinkedinPoolAccount[]; total: number }
  | { status: 'failed'; message: string };

const STATE_COPY: Record<LinkedinSessionState, { label: string; detail: string }> = {
  unconfigured: {
    label: 'Не настроено',
    detail: 'Добавьте аккаунт и откройте ручное окно LinkedIn.',
  },
  login_required: { label: 'Нужно войти', detail: 'Откройте desktop-окно и войдите вручную.' },
  user_action_required: {
    label: 'Нужна проверка',
    detail: 'Продолжите вход, 2FA или CAPTCHA в desktop-окне.',
  },
  checking: { label: 'Проверяем сессию', detail: 'Проверяем подтверждение входа.' },
  ready: { label: 'Вход подтверждён', detail: 'Последняя проверка подтвердила вход. Текущий статус можно проверить в приложении.' },
  expired: { label: 'Сессия истекла', detail: 'Повторите ручной вход в desktop-окне.' },
  challenge_required: {
    label: 'Нужна проверка LinkedIn',
    detail: 'Завершите проверку LinkedIn вручную.',
  },
  cooling_down: {
    label: 'Пауза',
    detail: 'Аккаунт временно не используется до следующей проверки.',
  },
  revoked: { label: 'Отозвано', detail: 'Сессия остановлена. Подключите аккаунт заново.' },
  banned: { label: 'Ограничен провайдером', detail: 'Автоматического обхода или ротации нет.' },
  disabled: { label: 'Отключено', detail: 'Аккаунт отключён администратором.' },
};

function statusClass(state: LinkedinSessionState): string {
  if (state === 'ready') return 'is-success';
  if (['challenge_required', 'expired', 'user_action_required'].includes(state))
    return 'is-warning';
  if (['banned', 'disabled', 'revoked'].includes(state)) return 'is-danger';
  return 'is-muted';
}

function formatMoment(value: string | null): string {
  if (!value) return 'Ещё не проверялась';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function capabilityCopy(value: LinkedinPoolAccount['capabilityVerdict']): string {
  switch (value) {
    case 'official_api':
      return 'Официальный API';
    case 'provider_permitted':
      return 'Разрешено провайдером';
    default:
      return 'Ожидает подтверждения';
  }
}

function managedOpenFailureCopy(reason?: string): string {
  switch (reason) {
    case 'desktop_runtime_required':
      return 'Откройте админку в приложении OpenQareer Desktop: только оно может создать отдельный профиль LinkedIn для этого аккаунта.';
    case 'window_not_registered':
      return 'Приложение не зарегистрировало окно LinkedIn. Перезапустите OpenQareer Desktop и повторите вход.';
    case 'managed_session_data_dir_unavailable':
    case 'managed_session_data_dir_create_failed':
      return 'Не удалось создать изолированный профиль LinkedIn на этом устройстве.';
    case 'managed_session_store_requires_macos_14':
      return 'Для изолированной сессии пула требуется macOS 14 или новее.';
    default:
      return 'Не удалось открыть отдельное окно LinkedIn. Перезапустите OpenQareer Desktop и повторите вход.';
  }
}

function localProfileFailureCopy(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message : typeof reason === 'string' ? reason : '';
  if (message.includes('managed_session_store_requires_macos_14')) {
    return 'Локальный профиль можно очистить только на macOS 14 или новее. Серверная операция не выполнена.';
  }
  return apiErrorMessage(reason, fallback);
}

function useLinkedinPool() {
  const [state, setState] = useState<PoolViewState>({ status: 'loading' });
  const requestNumber = useRef(0);
  const load = useCallback(async (signal?: AbortSignal) => {
    const currentRequest = ++requestNumber.current;
    setState({ status: 'loading' });
    try {
      const accounts: LinkedinPoolAccount[] = [];
      let offset: number | null = 0;
      let total = 0;
      while (offset !== null && accounts.length < 1000) {
        const page = await listAdminLinkedinAccounts({ signal, limit: 100, offset });
        accounts.push(...page.accounts);
        total = page.total;
        offset = page.nextOffset;
      }
      if (!signal?.aborted && currentRequest === requestNumber.current)
        setState({ status: 'ready', accounts, total });
    } catch (reason: unknown) {
      if (!signal?.aborted && currentRequest === requestNumber.current)
        setState({
          status: 'failed',
          message: apiErrorMessage(reason, 'Не удалось загрузить аккаунты LinkedIn.'),
        });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const refresh = useCallback(() => void load(), [load]);
  return { state, refresh };
}

// eslint-disable-next-line max-lines-per-function
export function AdminLinkedinPoolView() {
  const { state, refresh } = useLinkedinPool();
  const [identifier, setIdentifier] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [busyAccountId, setBusyAccountId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState<LinkedinPoolAccount>();
  const [confirmTransferAccountId, setConfirmTransferAccountId] = useState<string>();
  const [activeLogin, setActiveLogin] = useState<ActiveLinkedinLogin>();
  const [verifiedSessionAccountId, setVerifiedSessionAccountId] = useState<string>();
  const [verifiedSessionMarker, setVerifiedSessionMarker] = useState<string>();
  const [localCleanupPendingAccountId, setLocalCleanupPendingAccountId] = useState<string>();
  const [query, setQuery] = useState('');
  const [accountTimezone, setAccountTimezone] = useState(DEFAULT_ACCOUNT_TIMEZONE);
  const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'action' | 'stopped'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'state' | 'verified'>('name');
  const [descending, setDescending] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createDetailsRef = useRef<HTMLDetailsElement>(null);
  const remoteLogin = useRemoteLoginLauncher(setError, refresh);
  useEscapeLayer(() => setConfirmDelete(undefined), Boolean(confirmDelete));
  useEscapeLayer(() => setConfirmTransferAccountId(undefined), Boolean(confirmTransferAccountId));
  useEscapeLayer(() => {
    if (!createDetailsRef.current) return;
    createDetailsRef.current.open = false;
    createDetailsRef.current.querySelector('summary')?.focus();
  }, createMenuOpen);

  useEffect(() => {
    if (!activeLogin) return;
    const resize = () => {
      void resizeConnectorSession(
        'linkedin',
        managedLinkedinSessionLayout(window.innerWidth, window.innerHeight),
        activeLogin.sessionKey,
      );
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [activeLogin]);

  const persistSession = useCallback(async (login: ActiveLinkedinLogin) => {
    const cookies = await exportPoolSessionCookies(login.sessionKey);
    return storeAdminLinkedinSession(login.accountId, cookies);
  }, []);

  useAdminLinkedinLoginPolling(
    activeLogin,
    refresh,
    setActiveLogin,
    setNotice,
    setError,
    setVerifiedSessionAccountId,
    setVerifiedSessionMarker,
  );

  async function addAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const created = await createAdminLinkedinAccount({
        adminLabel: identifier.trim(),
        emailLogin: identifier.trim(),
        timezone: accountTimezone.trim() || undefined,
      });
      setIdentifier('');
      setAccountTimezone(DEFAULT_ACCOUNT_TIMEZONE);
      setQuery('');
      setStatusFilter('all');
      setSortBy('name');
      setDescending(false);
      setExpandedId(created.id);
      if (createDetailsRef.current) createDetailsRef.current.open = false;
      setNotice(
        'Идентификатор добавлен. Нажмите «Войти в LinkedIn», чтобы открыть отдельное окно входа.',
      );
      refresh();
    } catch (reason: unknown) {
      setError(apiErrorMessage(reason, 'Не удалось добавить аккаунт LinkedIn.'));
    } finally {
      setFormBusy(false);
    }
  }

  async function openLogin(account: LinkedinPoolAccount) {
    if (activeLogin) return;
    setVerifiedSessionAccountId(undefined);
    setVerifiedSessionMarker(undefined);
    setConfirmTransferAccountId(undefined);
    if (!isTauriEnvironment()) {
      setError(managedOpenFailureCopy('desktop_runtime_required'));
      return;
    }
    setBusyAccountId(account.id);
    setError(undefined);
    setNotice(undefined);
    try {
      await startAdminLinkedinRoute();
    } catch (reason: unknown) {
      setError(adminRouteFailureCopy(reason));
      setBusyAccountId(undefined);
      return;
    }
    try {
      const started = await requestAdminLinkedinLogin(account.id);
      const opened = await openManagedLinkedinSession(
        started.account.profileIsolationId,
        managedLinkedinSessionLayout(window.innerWidth, window.innerHeight),
      );
      if (!opened.opened) {
        await endAdminLinkedinRoute();
        await completeAdminLinkedinLogin(account.id, started.lease.handle, { state: 'login_required' }).catch(() => undefined);
        setError(managedOpenFailureCopy(opened.reason));
        refresh();
        return;
      }
      setActiveLogin({
        accountId: account.id,
        sessionKey: started.account.profileIsolationId,
        handle: started.lease.handle,
      });
      setNotice('Проверяем отдельный профиль LinkedIn. Если вход требуется, завершите его в открытом окне.');
      refresh();
    } catch (reason: unknown) {
      await endAdminLinkedinRoute();
      setError(apiErrorMessage(reason, 'Не удалось запросить ручной вход.'));
    } finally {
      setBusyAccountId(undefined);
    }
  }

  async function saveServerSession(account: LinkedinPoolAccount) {
    const login = activeLogin;
    if (
      !login ||
      login.accountId !== account.id ||
      verifiedSessionAccountId !== account.id ||
      !verifiedSessionMarker
    ) {
      return;
    }
    setConfirmTransferAccountId(account.id);
  }

  async function confirmServerSessionTransfer(account: LinkedinPoolAccount) {
    const login = activeLogin;
    if (
      !login ||
      login.accountId !== account.id ||
      verifiedSessionAccountId !== account.id ||
      !verifiedSessionMarker ||
      confirmTransferAccountId !== account.id
    ) {
      return;
    }
    setBusyAccountId(account.id);
    setError(undefined);
    let storedOnServer = false;
    try {
      const session = await persistSession(login);
      storedOnServer = true;
      await endAdminLinkedinRoute();
      await clearPoolSessionProfile(login.sessionKey);
      setActiveLogin(undefined);
      setVerifiedSessionAccountId(undefined);
      setVerifiedSessionMarker(undefined);
      setConfirmTransferAccountId(undefined);
      setLocalCleanupPendingAccountId(undefined);
      setNotice(`Сессия сохранена на сервере до ${formatMoment(session.expiresAt)}.`);
      refresh();
    } catch (reason: unknown) {
      setConfirmTransferAccountId(undefined);
      if (storedOnServer) {
        setActiveLogin(undefined);
        setVerifiedSessionAccountId(undefined);
        setVerifiedSessionMarker(undefined);
        setLocalCleanupPendingAccountId(account.id);
        setError(
          `Сессия сохранена на сервере, но ${localProfileFailureCopy(
            reason,
            'локальный профиль не очищен. Повторите очистку из приложения.',
          )}`,
        );
        setNotice('Cookies уже зашифрованы на сервере. Локальная копия останется до успешной очистки профиля.');
      } else {
        setError(apiErrorMessage(reason, transferFailureCopy(reason)));
        setNotice('Окно LinkedIn осталось открытым. Проверьте вход и повторите перенос.');
      }
      refresh();
    } finally {
      setBusyAccountId(undefined);
    }
  }

  async function clearLocalProfile(account: LinkedinPoolAccount) {
    setBusyAccountId(account.id);
    setError(undefined);
    try {
      await clearPoolSessionProfile(account.profileIsolationId);
      if (activeLogin?.accountId === account.id) setActiveLogin(undefined);
      if (verifiedSessionAccountId === account.id) setVerifiedSessionAccountId(undefined);
      if (verifiedSessionAccountId === account.id) setVerifiedSessionMarker(undefined);
      setLocalCleanupPendingAccountId(undefined);
      setNotice('Локальный профиль LinkedIn очищен на этом устройстве.');
      refresh();
    } catch (reason: unknown) {
      setLocalCleanupPendingAccountId(account.id);
      setError(localProfileFailureCopy(reason, 'Не удалось очистить локальный профиль LinkedIn.'));
    } finally {
      setBusyAccountId(undefined);
    }
  }

  async function runAccountAction(
    account: LinkedinPoolAccount,
    action: () => Promise<unknown>,
    successMessage: string,
  ) {
    setBusyAccountId(account.id);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
      setNotice(successMessage);
      refresh();
    } catch (reason: unknown) {
      setError(apiErrorMessage(reason, 'Операция над аккаунтом LinkedIn не выполнена.'));
    } finally {
      setBusyAccountId(undefined);
    }
  }

  async function clearAccountLocalProfile(account: LinkedinPoolAccount) {
    try {
      await clearPoolSessionProfile(account.profileIsolationId);
    } catch (reason: unknown) {
      throw new Error(localProfileFailureCopy(reason, 'Не удалось очистить локальный профиль LinkedIn.'));
    }
    if (activeLogin?.accountId === account.id) setActiveLogin(undefined);
    if (verifiedSessionAccountId === account.id) {
      setVerifiedSessionAccountId(undefined);
      setVerifiedSessionMarker(undefined);
    }
    if (confirmTransferAccountId === account.id) setConfirmTransferAccountId(undefined);
    setLocalCleanupPendingAccountId(undefined);
  }

  async function deleteAccount() {
    if (!confirmDelete) return;
    await runAccountAction(
      confirmDelete,
      async () => {
        await clearAccountLocalProfile(confirmDelete);
        await deleteAdminLinkedinAccount(confirmDelete.id, confirmDelete.revision);
        setConfirmDelete(undefined);
      },
      'Аккаунт удалён, runtime-копия отозвана.',
    );
  }

  async function revokeAccount(account: LinkedinPoolAccount) {
    await runAccountAction(
      account,
      async () => {
        await clearAccountLocalProfile(account);
        await revokeAdminLinkedinAccount(account.id);
      },
      'Сессия отозвана, локальный профиль очищен.',
    );
  }

  async function closeLoginWindow(account: LinkedinPoolAccount) {
    if (activeLogin?.accountId !== account.id) return;
    setBusyAccountId(account.id);
    await closeConnectorSession('linkedin', activeLogin.sessionKey).catch(() => undefined);
    await endAdminLinkedinRoute();
    await completeAdminLinkedinLogin(account.id, activeLogin.handle, { state: 'login_required' }).catch(() => undefined);
    setActiveLogin(undefined);
    setVerifiedSessionAccountId(undefined);
    setVerifiedSessionMarker(undefined);
    setConfirmTransferAccountId(undefined);
    setBusyAccountId(undefined);
    setError(undefined);
    setNotice('Окно LinkedIn закрыто. Нажмите «Войти в LinkedIn», чтобы продолжить.');
    refresh();
  }

  async function removeServerSession(account: LinkedinPoolAccount) {
    await runAccountAction(
      account,
      async () => {
        await clearAccountLocalProfile(account);
        await deleteAdminLinkedinSession(account.id);
      },
      'Сессия удалена с сервера и локальный профиль очищен.',
    );
  }

  const visibleAccounts = state.status === 'ready'
    ? state.accounts
      .filter((account) => !query.trim() || [account.emailLogin, account.adminLabel]
        .some((value) => value.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU'))))
      .filter((account) => statusFilter === 'all' ||
        (statusFilter === 'ready' && account.state === 'ready') ||
        (statusFilter === 'action' && ['login_required', 'user_action_required', 'challenge_required', 'expired', 'unconfigured', 'checking'].includes(account.state)) ||
        (statusFilter === 'stopped' && ['revoked', 'disabled', 'banned', 'cooling_down'].includes(account.state)))
      .sort((left, right) => {
        const a = sortBy === 'name' ? left.emailLogin : sortBy === 'state' ? STATE_COPY[left.state].label : left.lastVerifiedAt ?? '';
        const b = sortBy === 'name' ? right.emailLogin : sortBy === 'state' ? STATE_COPY[right.state].label : right.lastVerifiedAt ?? '';
        const order = a.localeCompare(b, 'ru-RU');
        return (descending ? -order : order) || left.id.localeCompare(right.id);
      })
    : [];

  return (
    <section className="admin-linkedin-pool" aria-labelledby="admin-linkedin-pool-title">
      <header className="admin-section-header admin-linkedin-header">
        <div>
          <p className="admin-eyebrow">Администрирование / сессии</p>
          <h1 id="admin-linkedin-pool-title">Аккаунты LinkedIn</h1>
          <p className="admin-note">Подключение и проверка каждого аккаунта в отдельном окне OpenQareer Desktop.</p>
        </div>
        <button className="admin-btn is-secondary" type="button" onClick={refresh}>
          <ArrowClockwise size={18} aria-hidden="true" /> Обновить
        </button>
      </header>

      <details className="admin-linkedin-create" ref={createDetailsRef} onToggle={(event) => setCreateMenuOpen(event.currentTarget.open)}>
        <summary><Plus size={18} aria-hidden="true" /> Добавить аккаунт</summary>
      <form className="admin-linkedin-add" onSubmit={(event) => void addAccount(event)}>
        <div className="admin-linkedin-add__heading">
          <LinkedinLogo size={24} aria-hidden="true" />
          <div>
            <h2>Новый аккаунт</h2>
            <p>Добавьте идентификатор, затем откройте вход в приложении.</p>
          </div>
        </div>
        <div className="admin-linkedin-add__fields">
          <label>
            <span>Идентификатор сессии</span>
            <input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="name@example.com"
              required
              maxLength={254}
              autoComplete="off"
            />
          </label>
          <TimezoneSelect
            name="timezone"
            value={accountTimezone}
            onChange={(event) => setAccountTimezone(event.target.value)}
            disabled={formBusy}
          />
        </div>
        <button
          className="admin-btn admin-btn--primary"
          type="submit"
          disabled={formBusy}
          aria-busy={formBusy}
        >
          <Plus size={18} aria-hidden="true" /> {formBusy ? 'Добавляем…' : 'Добавить аккаунт'}
        </button>
      </form>
      </details>

      <div className="admin-register-toolbar">
        <label className="admin-register-search">Поиск аккаунта
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Идентификатор или метка" />
        </label>
        <div className="admin-register-chips" aria-label="Состояние аккаунтов LinkedIn">
          {([['all', 'Все'], ['ready', 'Вход есть'], ['action', 'Нужен вход'], ['stopped', 'Остановлены']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)}>{label}</button>
          ))}
        </div>
        <div className="admin-register-chips" aria-label="Порядок аккаунтов LinkedIn">
          {([['name', 'Имя'], ['state', 'Статус'], ['verified', 'Проверка']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={sortBy === value} onClick={() => { setSortBy(value); setDescending(value === 'verified'); }}>{label}</button>
          ))}
          <button type="button" onClick={() => setDescending((value) => !value)} aria-label="Изменить направление сортировки">{descending ? '↓' : '↑'}</button>
        </div>
      </div>

      {notice ? (
        <p className="admin-success" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
      {state.status === 'loading' ? (
        <p className="admin-note" aria-busy="true">
          Загружаем реестр LinkedIn…
        </p>
      ) : null}
      {state.status === 'failed' ? (
        <div className="admin-error" role="alert">
          <p>{state.message}</p>
          <button className="admin-btn is-secondary" type="button" onClick={refresh}>
            Повторить
          </button>
        </div>
      ) : null}
      {state.status === 'ready' && state.accounts.length === 0 ? (
        <p className="admin-empty-state">
          Аккаунтов пула пока нет. Откройте «Добавить аккаунт».
        </p>
      ) : null}
      {state.status === 'ready' && state.accounts.length > 0 ? (
        <p className="admin-register-count">Показано {visibleAccounts.length} из {state.total} аккаунтов{state.total > state.accounts.length ? ' (первые 1000 загружены)' : ''}</p>
      ) : null}
      {state.status === 'ready' && state.accounts.length > 0 && visibleAccounts.length === 0 ? (
        <p className="admin-empty-state">Аккаунты по выбранным условиям не найдены.</p>
      ) : null}
      {state.status === 'ready' ? (
        <div className="admin-linkedin-grid" aria-live="polite">
          {/* eslint-disable-next-line max-lines-per-function -- the card keeps status, actions and destructive confirmation together */}
          {visibleAccounts.map((account) => {
            const copy = STATE_COPY[account.state];
            const busy = busyAccountId === account.id;
            const canLogin = [
              'unconfigured',
              'login_required',
              'user_action_required',
              'ready',
              'checking',
              'expired',
              'challenge_required',
              'revoked',
            ].includes(account.state);
            return (
              <article className="admin-linkedin-card" key={account.id} aria-busy={busy}>
                <button className="admin-linkedin-row__toggle" type="button" aria-expanded={expandedId === account.id} onClick={() => setExpandedId((value) => value === account.id ? null : account.id)}>
                  <strong>{account.emailLogin}</strong>
                  <span className={`admin-badge ${statusClass(account.state)}`}>{copy.label}</span>
                  <span className="admin-linkedin-row__date">{formatMoment(account.lastVerifiedAt)}</span>
                  <CaretDown className={expandedId === account.id ? 'is-expanded' : ''} size={18} aria-hidden="true" />
                </button>
                {expandedId === account.id ? <div className="admin-linkedin-row__detail">
                <p className="admin-linkedin-card__detail">{copy.detail}</p>
                {activeLogin?.accountId === account.id ? (
                  <p className="admin-linkedin-card__active" role="status">
                    {verifiedSessionAccountId === account.id && verifiedSessionMarker
                      ? `Профиль /in/${verifiedSessionMarker} подтверждён. Проверьте, что это ${account.emailLogin}.`
                      : 'Окно LinkedIn открыто. Ожидаем подтверждение входа…'}
                  </p>
                ) : null}
                {adminLinkedinFailureCopy(account.lastFailureCode) ? (
                  <p className="admin-linkedin-card__failure" role="status">
                    <WarningCircle size={16} aria-hidden="true" />
                    {adminLinkedinFailureCopy(account.lastFailureCode)}
                  </p>
                ) : null}
                <dl className="admin-linkedin-card__meta">
                  <div>
                    <dt>Последняя проверка</dt>
                    <dd>{formatMoment(account.lastVerifiedAt)}</dd>
                  </div>
                  <div>
                    <dt>Heartbeat</dt>
                    <dd>{formatMoment(account.lastHeartbeatAt)}</dd>
                  </div>
                  <div>
                    <dt>Доступ источника</dt>
                    <dd>{capabilityCopy(account.capabilityVerdict)}</dd>
                  </div>
                  <div>
                    <dt>Часовой пояс</dt>
                    <dd>{formatTimezoneDisplay(account.timezone)}</dd>
                  </div>
                  <AdminLinkedinServerSessionMeta account={account} />
                </dl>
                <div className="admin-linkedin-card__actions">
                  {activeLogin?.accountId === account.id ? (
                    <button
                      className="admin-btn is-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void closeLoginWindow(account)}
                    >
                      <X size={18} aria-hidden="true" /> Закрыть окно
                    </button>
                  ) : null}
                  {canLogin ? (
                    <button
                      className="admin-btn admin-btn--primary"
                      type="button"
                      disabled={busy || remoteLogin.startingAccountId === account.id}
                      aria-busy={remoteLogin.startingAccountId === account.id}
                      onClick={() =>
                        void remoteLogin.open(account.id, account.adminLabel || account.emailLogin)
                      }
                    >
                      <Browser size={18} aria-hidden="true" />{' '}
                      {remoteLogin.startingAccountId === account.id
                        ? 'Открываем браузер сервера…'
                        : 'Войти в браузере сервера'}
                    </button>
                  ) : null}
                  {canLogin && activeLogin?.accountId !== account.id ? (
                    <button
                      className="admin-btn is-secondary"
                      type="button"
                      disabled={busy || Boolean(activeLogin)}
                      onClick={() => void openLogin(account)}
                    >
                      <Desktop size={18} aria-hidden="true" />{' '}
                      {account.state === 'ready' || account.state === 'checking'
                        ? 'Проверить в приложении'
                        : 'Войти в LinkedIn'}
                    </button>
                  ) : null}
                  <AdminLinkedinServerSessionActions
                    account={account}
                    canSave={
                      activeLogin?.accountId === account.id &&
                      verifiedSessionAccountId === account.id &&
                      Boolean(verifiedSessionMarker)
                    }
                    canClearLocal={Boolean(account.serverSession) || localCleanupPendingAccountId === account.id}
                    cleanupPending={localCleanupPendingAccountId === account.id}
                    busy={busy}
                    onSave={() => void saveServerSession(account)}
                    onClearLocal={() => void clearLocalProfile(account)}
                    onDelete={() => void removeServerSession(account)}
                  />
                  {account.state !== 'revoked' && account.state !== 'disabled' ? (
                    <button
                      className="admin-btn is-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() => void revokeAccount(account)}
                    >
                      <LinkBreak size={18} aria-hidden="true" /> Отозвать
                    </button>
                  ) : null}
                  <button
                    className="admin-btn admin-btn--danger-outline"
                    type="button"
                    disabled={busy}
                    onClick={() => setConfirmDelete(account)}
                  >
                    <Trash size={18} aria-hidden="true" /> Удалить
                  </button>
                </div>
                {confirmDelete?.id === account.id ? (
                  <div
                    className="admin-linkedin-confirm"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby={`delete-title-${account.id}`}
                  >
                    <h3 id={`delete-title-${account.id}`}>Удалить аккаунт LinkedIn?</h3>
                    <p>
                      Будет отозвана сессия и удалена runtime-копия профиля. Идентификатор
                      перестанет быть доступен в реестре.
                    </p>
                    <div>
                      <button
                        className="admin-btn is-secondary"
                        type="button"
                        onClick={() => setConfirmDelete(undefined)}
                      >
                        Отмена
                      </button>
                      <button
                        className="admin-btn admin-btn--danger"
                        type="button"
                        onClick={() => void deleteAccount()}
                      >
                        Удалить аккаунт
                      </button>
                    </div>
                  </div>
                ) : null}
                {confirmTransferAccountId === account.id &&
                verifiedSessionAccountId === account.id &&
                verifiedSessionMarker ? (
                  <div
                    className="admin-linkedin-confirm"
                    role="alertdialog"
                    aria-modal="true"
                    aria-labelledby={`transfer-title-${account.id}`}
                  >
                    <h3 id={`transfer-title-${account.id}`}>Перенести сессию на сервер?</h3>
                    <p>
                      Cookies профиля /in/{verifiedSessionMarker} будут отправлены по защищённому
                      соединению и зашифрованы в хранилище аккаунта {account.emailLogin}.
                    </p>
                    <p>
                      Сервер хранит их до срока cookie li_at. Плановая очистка проходит при запуске
                      и каждые 15 минут; при ошибке сервис повторит её через минуту. После успешной
                      передачи локальный профиль LinkedIn на этом устройстве будет удалён.
                    </p>
                    <p>Продолжайте только если профиль LinkedIn принадлежит этому аккаунту пула.</p>
                    <div>
                      <button
                        className="admin-btn is-secondary"
                        type="button"
                        onClick={() => setConfirmTransferAccountId(undefined)}
                      >
                        Отмена
                      </button>
                      <button
                        className="admin-btn admin-btn--primary"
                        type="button"
                        disabled={busy}
                        onClick={() => void confirmServerSessionTransfer(account)}
                      >
                        {busy ? 'Переносим сессию…' : 'Подтвердить перенос'}
                      </button>
                    </div>
                  </div>
                ) : null}
                </div> : null}
              </article>
            );
          })}
        </div>
      ) : null}
      {remoteLogin.target ? (
        <AdminLinkedinRemoteLoginPanel {...remoteLogin.target} onClose={remoteLogin.close} />
      ) : null}
    </section>
  );
}
