import { useCallback, useEffect, useState } from 'react';
import {
  ArrowClockwise,
  CheckCircle,
  Desktop,
  LinkBreak,
  LinkedinLogo,
  Plus,
  ShieldWarning,
  Trash,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import { apiErrorMessage } from '../coach/apiClient';
import { isTauriEnvironment } from '../../services/desktop/desktopBridge';
import {
  closeConnectorSession,
  inspectSessionPage,
  managedLinkedinSessionLayout,
  openManagedLinkedinSession,
  readSessionPage,
  resizeConnectorSession,
  type SessionInspectionResult,
  type ManagedSessionKey,
} from '../connections/connectorSession';
import {
  createLinkedInSessionImportFlow,
  type LinkedInWaitingStage,
} from '../connections/linkedinSessionPoll';
import {
  completeAdminLinkedinLogin,
  createAdminLinkedinAccount,
  deleteAdminLinkedinAccount,
  listAdminLinkedinAccounts,
  probeAdminLinkedinAccount,
  requestAdminLinkedinLogin,
  revokeAdminLinkedinAccount,
  type LinkedinPoolAccount,
  type LinkedinSessionState,
} from './linkedinPoolApi';

type PoolViewState =
  | { status: 'loading' }
  | { status: 'ready'; accounts: LinkedinPoolAccount[]; total: number }
  | { status: 'failed'; message: string };

type ActiveLinkedinLogin = {
  accountId: string;
  sessionKey: ManagedSessionKey;
  handle: string;
};

const ADMIN_WAITING_COPY: Record<LinkedInWaitingStage, string> = {
  loading: 'Загружаем страницу LinkedIn…',
  login: 'Введите логин и пароль в открытом окне LinkedIn.',
  otp: 'Введите код 2FA в открытом окне LinkedIn.',
  captcha: 'Пройдите CAPTCHA в открытом окне LinkedIn.',
  unrecognised: 'Вход ещё не подтверждён. Откройте свой профиль в окне LinkedIn.',
};

export function isAdminProfileCaptureFailure(reason: unknown): boolean {
  const code = reason instanceof Error ? reason.message : String(reason ?? '');
  return (
    code === 'linkedin_authenticated_capture_failed' ||
    code === 'linkedin_authenticated_profile_unclassified'
  );
}

export function isSafeAdminLinkedinSessionPage(page: SessionInspectionResult): boolean {
  try {
    const url = new URL(page.url);
    const host = url.hostname.toLowerCase();
    return (
      page.ready &&
      url.protocol === 'https:' &&
      (host === 'linkedin.com' ||
        host.endsWith('.linkedin.com') ||
        host === 'linkedin.cn' ||
        host.endsWith('.linkedin.cn')) &&
      !page.login &&
      !page.otp &&
      !page.captcha
    );
  } catch {
    return false;
  }
}

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
  ready: { label: 'Сессия подтверждена', detail: 'Вход подтверждён, сессия готова.' },
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

function failureCopy(code: LinkedinPoolAccount['lastFailureCode']): string | null {
  switch (code) {
    case 'session_runtime_unavailable':
      return 'Окно ручного входа доступно только в приложении OpenQareer Desktop.';
    case 'provider_probe_unavailable':
      return 'Автоматическая проверка сессии пока недоступна. Откройте вход в отдельном окне ещё раз.';
    case 'provider_permission_required':
      return 'Источник LinkedIn отключён: для него нет разрешения провайдера.';
    case 'provider_probe_failed':
      return 'LinkedIn не подтвердил эту сессию. Повторите вход в отдельном окне.';
    default:
      return null;
  }
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
    default:
      return 'Не удалось открыть отдельное окно LinkedIn. Перезапустите OpenQareer Desktop и повторите вход.';
  }
}

function useLinkedinPool() {
  const [state, setState] = useState<PoolViewState>({ status: 'loading' });
  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ status: 'loading' });
    try {
      const page = await listAdminLinkedinAccounts({ signal });
      if (!signal?.aborted)
        setState({ status: 'ready', accounts: page.accounts, total: page.total });
    } catch (reason: unknown) {
      if (!signal?.aborted)
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

// eslint-disable-next-line max-lines-per-function -- this hook owns one candidate-equivalent auth lifecycle
function useAdminLinkedinLoginPolling(
  activeLogin: ActiveLinkedinLogin | undefined,
  refresh: () => void,
  setActiveLogin: (value: ActiveLinkedinLogin | undefined) => void,
  setNotice: (value: string | undefined) => void,
  setError: (value: string | undefined) => void,
): void {
  // eslint-disable-next-line max-lines-per-function -- this effect owns one candidate-equivalent auth lifecycle
  useEffect(() => {
    if (!activeLogin) return;
    let cancelled = false;
    let finished = false;
    let authenticated = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = async (accountMarker?: string | null) => {
      const account = await completeAdminLinkedinLogin(activeLogin.accountId, activeLogin.handle, {
        state: 'ready',
        ...(accountMarker ? { accountMarker } : {}),
      });
      await closeConnectorSession('linkedin', activeLogin.sessionKey).catch(() => undefined);
      if (cancelled) return;
      finished = true;
      setActiveLogin(undefined);
      setError(undefined);
      setNotice(`Вход подтверждён. Идентификатор ${account.emailLogin} привязан к приложению.`);
      refresh();
    };

    const flow = createLinkedInSessionImportFlow({
      inspectCurrentPage: () => inspectSessionPage('linkedin', activeLogin.sessionKey),
      readSessionPage: (url) => readSessionPage('linkedin', url, activeLogin.sessionKey),
      onAuthenticated: () => {
        authenticated = true;
        if (!cancelled) setNotice('Вход распознан. Читаем профиль LinkedIn для подтверждения…');
      },
      // Keep the managed window open until the admin lease is completed. The
      // candidate flow closes it after capture; admin owns a persistent pool
      // profile and must complete the server transition first.
      onProviderDataCaptured: () => undefined,
      onReady: (result) => finish(result.accountMarker),
    });

    const poll = async () => {
      if (cancelled || finished) return;
      try {
        const result = await flow.run();
        if (cancelled || finished) return;
        if (result.status === 'waiting_for_sign_in') {
          setNotice(ADMIN_WAITING_COPY[result.stage]);
          timer = setTimeout(() => void poll(), 1_000);
        }
      } catch (reason: unknown) {
        if (cancelled) return;
        if (authenticated && isAdminProfileCaptureFailure(reason)) {
          try {
            const confirmation = await inspectSessionPage('linkedin', activeLogin.sessionKey);
            if (isSafeAdminLinkedinSessionPage(confirmation)) {
              await finish(confirmation.accountMarker);
              return;
            }
          } catch {
            // Fall through to the truthful capture error below.
          }
        }
        finished = true;
        await closeConnectorSession('linkedin', activeLogin.sessionKey).catch(() => undefined);
        setActiveLogin(undefined);
        setError(
          apiErrorMessage(
            reason,
            'LinkedIn вошёл, но профиль не удалось прочитать. Откройте вход ещё раз.',
          ),
        );
        refresh();
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [activeLogin, refresh, setActiveLogin, setError, setNotice]);
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
  const [activeLogin, setActiveLogin] = useState<ActiveLinkedinLogin>();

  useEffect(() => {
    if (!confirmDelete) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmDelete(undefined);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmDelete]);

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

  useAdminLinkedinLoginPolling(activeLogin, refresh, setActiveLogin, setNotice, setError);

  async function addAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await createAdminLinkedinAccount({
        adminLabel: identifier.trim(),
        emailLogin: identifier.trim(),
      });
      setIdentifier('');
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
    if (!isTauriEnvironment()) {
      setError(managedOpenFailureCopy('desktop_runtime_required'));
      return;
    }
    setBusyAccountId(account.id);
    setError(undefined);
    setNotice(undefined);
    try {
      const started = await requestAdminLinkedinLogin(account.id);
      const opened = await openManagedLinkedinSession(
        started.account.profileIsolationId,
        managedLinkedinSessionLayout(window.innerWidth, window.innerHeight),
      );
      if (!opened.opened) {
        setError(managedOpenFailureCopy(opened.reason));
        refresh();
        return;
      }
      setActiveLogin({
        accountId: account.id,
        sessionKey: started.account.profileIsolationId,
        handle: started.lease.handle,
      });
      setNotice('Отдельное окно LinkedIn открыто. Завершите вход. Статус обновится автоматически.');
      refresh();
    } catch (reason: unknown) {
      setError(apiErrorMessage(reason, 'Не удалось запросить ручной вход.'));
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

  async function deleteAccount() {
    if (!confirmDelete) return;
    await runAccountAction(
      confirmDelete,
      async () => {
        if (activeLogin?.accountId === confirmDelete.id) {
          await closeConnectorSession('linkedin', activeLogin.sessionKey).catch(() => undefined);
          setActiveLogin(undefined);
        }
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
        if (activeLogin?.accountId === account.id) {
          await closeConnectorSession('linkedin', activeLogin.sessionKey).catch(() => undefined);
          setActiveLogin(undefined);
        }
        await revokeAdminLinkedinAccount(account.id);
      },
      'Сессия отозвана.',
    );
  }

  async function closeLoginWindow(account: LinkedinPoolAccount) {
    if (activeLogin?.accountId !== account.id) return;
    setBusyAccountId(account.id);
    await closeConnectorSession('linkedin', activeLogin.sessionKey).catch(() => undefined);
    setActiveLogin(undefined);
    setBusyAccountId(undefined);
    setError(undefined);
    setNotice('Окно LinkedIn закрыто. Нажмите «Войти в LinkedIn», чтобы продолжить.');
    refresh();
  }

  return (
    <section className="admin-linkedin-pool" aria-labelledby="admin-linkedin-pool-title">
      <header className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Управляемые сессии</p>
          <h1 id="admin-linkedin-pool-title">Аккаунты LinkedIn</h1>
          <p className="admin-note">
            Полный идентификатор сессии виден здесь только администратору. Пароли, cookie, 2FA-коды
            и storage state не попадают в API, браузер или журнал.
          </p>
          <p className="admin-note">
            Кнопка входа открывает отдельный профиль LinkedIn в OpenQareer Desktop. Введите данные
            только в окне LinkedIn.
          </p>
        </div>
        <button className="admin-btn is-secondary" type="button" onClick={refresh}>
          <ArrowClockwise size={18} aria-hidden="true" /> Обновить
        </button>
      </header>

      <form className="admin-linkedin-add" onSubmit={(event) => void addAccount(event)}>
        <div className="admin-linkedin-add__heading">
          <LinkedinLogo size={24} aria-hidden="true" />
          <div>
            <h2>Добавить аккаунт пула</h2>
            <p>
              Укажите понятный вам идентификатор: email, имя аккаунта или свою метку. Он сохраняется
              зашифрованным и виден без маскировки только администратору.
            </p>
          </div>
        </div>
        <div className="admin-linkedin-add__fields">
          <label>
            <span>Идентификатор сессии</span>
            <input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="LinkedIn-1 или name@example.com"
              required
              maxLength={254}
              autoComplete="off"
            />
          </label>
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
          Аккаунтов пула пока нет. Добавьте первый идентификатор выше.
        </p>
      ) : null}
      {state.status === 'ready' ? (
        <div className="admin-linkedin-grid" aria-live="polite">
          {/* eslint-disable-next-line max-lines-per-function -- the card keeps status, actions and destructive confirmation together */}
          {state.accounts.map((account) => {
            const copy = STATE_COPY[account.state];
            const busy = busyAccountId === account.id;
            const canLogin = [
              'unconfigured',
              'login_required',
              'user_action_required',
              'expired',
              'challenge_required',
              'revoked',
            ].includes(account.state);
            return (
              <article className="admin-linkedin-card" key={account.id} aria-busy={busy}>
                <header className="admin-linkedin-card__header">
                  <div>
                    <p className="admin-eyebrow">Идентификатор сессии</p>
                    <h2>{account.emailLogin}</h2>
                  </div>
                  <span className={`admin-badge ${statusClass(account.state)}`}>{copy.label}</span>
                </header>
                <p className="admin-linkedin-card__detail">{copy.detail}</p>
                {activeLogin?.accountId === account.id ? (
                  <p className="admin-linkedin-card__active" role="status">
                    Окно LinkedIn открыто. Ожидаем подтверждение входа…
                  </p>
                ) : null}
                {failureCopy(account.lastFailureCode) ? (
                  <p className="admin-linkedin-card__failure">
                    <WarningCircle size={16} aria-hidden="true" />
                    {failureCopy(account.lastFailureCode)}
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
                      disabled={busy}
                      onClick={() => void openLogin(account)}
                    >
                      <Desktop size={18} aria-hidden="true" /> Войти в LinkedIn
                    </button>
                  ) : null}
                  {['ready', 'checking'].includes(account.state) ? (
                    <button
                      className="admin-btn is-secondary"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void runAccountAction(
                          account,
                          () => probeAdminLinkedinAccount(account.id),
                          'Проверка статуса отправлена.',
                        )
                      }
                    >
                      <CheckCircle size={18} aria-hidden="true" /> Проверить сессию
                    </button>
                  ) : null}
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
              </article>
            );
          })}
        </div>
      ) : null}
      <p className="admin-scope-note">
        <ShieldWarning size={18} aria-hidden="true" /> Обычные пользователи не получают этот раздел,
        его API или идентификаторы аккаунтов. Источник LinkedIn остаётся отключённым, пока не
        подтверждена разрешённая интеграция провайдера.
      </p>
    </section>
  );
}
