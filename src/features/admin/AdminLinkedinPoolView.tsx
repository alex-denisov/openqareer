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
} from '@phosphor-icons/react';
import { apiErrorMessage } from '../coach/apiClient';
import {
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

const STATE_COPY: Record<LinkedinSessionState, { label: string; detail: string }> = {
  unconfigured: { label: 'Не настроено', detail: 'Добавьте аккаунт и откройте ручное окно LinkedIn.' },
  login_required: { label: 'Нужно войти', detail: 'Откройте desktop-окно и войдите вручную.' },
  user_action_required: { label: 'Нужна проверка', detail: 'Продолжите вход, 2FA или CAPTCHA в desktop-окне.' },
  checking: { label: 'Проверяем сессию', detail: 'Сервер ждёт подтверждённый provider probe.' },
  ready: { label: 'Сессия подтверждена', detail: 'Есть свежая проверка provider/session marker.' },
  expired: { label: 'Сессия истекла', detail: 'Повторите ручной вход в desktop-окне.' },
  challenge_required: { label: 'Нужна проверка LinkedIn', detail: 'Завершите проверку LinkedIn вручную.' },
  cooling_down: { label: 'Пауза', detail: 'Аккаунт временно не используется до следующей проверки.' },
  revoked: { label: 'Отозвано', detail: 'Lease остановлен. Подключите аккаунт заново.' },
  banned: { label: 'Ограничен провайдером', detail: 'Автоматического обхода или ротации нет.' },
  disabled: { label: 'Отключено', detail: 'Аккаунт отключён администратором.' },
};

function statusClass(state: LinkedinSessionState): string {
  if (state === 'ready') return 'is-success';
  if (['challenge_required', 'expired', 'user_action_required'].includes(state)) return 'is-warning';
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
      return 'Окно ручного входа доступно только в desktop runtime.';
    case 'provider_probe_unavailable':
      return 'Проверка provider/session marker ещё не подключена к этому runtime.';
    case 'provider_permission_required':
      return 'LinkedIn source остаётся выключенным без официального разрешения провайдера.';
    case 'provider_probe_failed':
      return 'Проверка не подтвердила выбранный аккаунт.';
    default:
      return null;
  }
}

function useLinkedinPool() {
  const [state, setState] = useState<PoolViewState>({ status: 'loading' });
  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ status: 'loading' });
    try {
      const page = await listAdminLinkedinAccounts({ signal });
      if (!signal?.aborted) setState({ status: 'ready', accounts: page.accounts, total: page.total });
    } catch (reason: unknown) {
      if (!signal?.aborted) setState({ status: 'failed', message: apiErrorMessage(reason, 'Не удалось загрузить аккаунты LinkedIn.') });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  return { state, refresh: () => void load() };
}

// eslint-disable-next-line max-lines-per-function
export function AdminLinkedinPoolView() {
  const { state, refresh } = useLinkedinPool();
  const [adminLabel, setAdminLabel] = useState('');
  const [emailLogin, setEmailLogin] = useState('');
  const [providerAccountMarker, setProviderAccountMarker] = useState('');
  const [formBusy, setFormBusy] = useState(false);
  const [busyAccountId, setBusyAccountId] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [error, setError] = useState<string>();
  const [confirmDelete, setConfirmDelete] = useState<LinkedinPoolAccount>();

  useEffect(() => {
    if (!confirmDelete) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmDelete(undefined);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmDelete]);

  async function addAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await createAdminLinkedinAccount({
        adminLabel: adminLabel.trim(),
        emailLogin: emailLogin.trim(),
        ...(providerAccountMarker.trim() ? { providerAccountMarker: providerAccountMarker.trim() } : {}),
      });
      setAdminLabel('');
      setEmailLogin('');
      setProviderAccountMarker('');
      setNotice('Аккаунт добавлен в управляемый реестр. Сессия ещё не подтверждена.');
      refresh();
    } catch (reason: unknown) {
      setError(apiErrorMessage(reason, 'Не удалось добавить аккаунт LinkedIn.'));
    } finally {
      setFormBusy(false);
    }
  }

  async function openLogin(account: LinkedinPoolAccount) {
    setBusyAccountId(account.id);
    setError(undefined);
    setNotice(undefined);
    try {
      await requestAdminLinkedinLogin(account.id);
      setNotice('Desktop-only lease создан. Веб показывает статусы и управление, но не открывает общий кандидатский window для pool account.');
      setError('session_runtime_unavailable: нужен отдельный изолированный desktop runtime для этого аккаунта. Сессия не считается подключённой.');
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
        await deleteAdminLinkedinAccount(confirmDelete.id, confirmDelete.revision);
        setConfirmDelete(undefined);
      },
      'Аккаунт удалён, runtime-копия отозвана.',
    );
  }

  return (
    <section className="admin-linkedin-pool" aria-labelledby="admin-linkedin-pool-title">
      <header className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Управляемые сессии</p>
          <h1 id="admin-linkedin-pool-title">Аккаунты LinkedIn</h1>
          <p className="admin-note">
            Полный email login виден здесь только администратору. Пароли, cookie, 2FA-коды и storage state не попадают в API, браузер или журнал.
          </p>
          <p className="admin-note">Интерактивный вход открывается в desktop-приложении; веб оставляет только статусы и guarded operations.</p>
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
            <p>Идентификатор сохраняется зашифрованным и не маскируется в этом admin-only разделе.</p>
          </div>
        </div>
        <div className="admin-linkedin-add__fields">
          <label>
            <span>Метка администратора</span>
            <input value={adminLabel} onChange={(event) => setAdminLabel(event.target.value)} required maxLength={120} />
          </label>
          <label>
            <span>Полный email login</span>
            <input type="email" value={emailLogin} onChange={(event) => setEmailLogin(event.target.value)} required maxLength={254} autoComplete="off" />
          </label>
          <label>
            <span>Provider account marker, если известен</span>
            <input value={providerAccountMarker} onChange={(event) => setProviderAccountMarker(event.target.value)} maxLength={240} autoComplete="off" />
          </label>
        </div>
        <button className="admin-btn admin-btn--primary" type="submit" disabled={formBusy} aria-busy={formBusy}>
          <Plus size={18} aria-hidden="true" /> {formBusy ? 'Добавляем…' : 'Добавить аккаунт'}
        </button>
      </form>

      {notice ? <p className="admin-success" role="status">{notice}</p> : null}
      {error ? <p className="admin-error" role="alert">{error}</p> : null}
      {state.status === 'loading' ? <p className="admin-note" aria-busy="true">Загружаем реестр LinkedIn…</p> : null}
      {state.status === 'failed' ? <div className="admin-error" role="alert"><p>{state.message}</p><button className="admin-btn is-secondary" type="button" onClick={refresh}>Повторить</button></div> : null}
      {state.status === 'ready' && state.accounts.length === 0 ? <p className="admin-empty-state">Аккаунтов пула пока нет. Добавьте первый login выше.</p> : null}
      {state.status === 'ready' ? (
        <div className="admin-linkedin-grid" aria-live="polite">
          {state.accounts.map((account) => {
            const copy = STATE_COPY[account.state];
            const busy = busyAccountId === account.id;
            const canLogin = ['unconfigured', 'login_required', 'expired', 'challenge_required', 'revoked'].includes(account.state);
            return (
              <article className="admin-linkedin-card" key={account.id} aria-busy={busy}>
                <header className="admin-linkedin-card__header">
                  <div>
                    <p className="admin-eyebrow">{account.adminLabel}</p>
                    <h2>{account.adminLabel}</h2>
                  </div>
                  <span className={`admin-badge ${statusClass(account.state)}`}>{copy.label}</span>
                </header>
                <p className="admin-linkedin-card__login">
                  <span>Полный email login</span>
                  <code>{account.emailLogin}</code>
                </p>
                <p className="admin-linkedin-card__detail">{copy.detail}</p>
                {failureCopy(account.lastFailureCode) ? <p className="admin-linkedin-card__failure"><WarningCircle size={16} aria-hidden="true" />{failureCopy(account.lastFailureCode)}</p> : null}
                <dl className="admin-linkedin-card__meta">
                  <div><dt>Последняя проверка</dt><dd>{formatMoment(account.lastVerifiedAt)}</dd></div>
                  <div><dt>Heartbeat</dt><dd>{formatMoment(account.lastHeartbeatAt)}</dd></div>
                  <div><dt>Provider capability</dt><dd>{account.capabilityVerdict}</dd></div>
                </dl>
                <div className="admin-linkedin-card__actions">
                  {canLogin ? <button className="admin-btn admin-btn--primary" type="button" disabled={busy} onClick={() => void openLogin(account)}><Desktop size={18} aria-hidden="true" /> Запросить desktop-вход</button> : null}
                  {['ready', 'checking', 'user_action_required'].includes(account.state) ? <button className="admin-btn is-secondary" type="button" disabled={busy} onClick={() => void runAccountAction(account, () => probeAdminLinkedinAccount(account.id), 'Проверка запрошена; зелёный статус появится только после provider probe.')}><CheckCircle size={18} aria-hidden="true" /> Проверить сессию</button> : null}
                  {account.state !== 'revoked' && account.state !== 'disabled' ? <button className="admin-btn is-secondary" type="button" disabled={busy} onClick={() => void runAccountAction(account, () => revokeAdminLinkedinAccount(account.id), 'Сессия отозвана.')}><LinkBreak size={18} aria-hidden="true" /> Отозвать</button> : null}
                  <button className="admin-btn admin-btn--danger-outline" type="button" disabled={busy} onClick={() => setConfirmDelete(account)}><Trash size={18} aria-hidden="true" /> Удалить</button>
                </div>
                {confirmDelete?.id === account.id ? (
                  <div className="admin-linkedin-confirm" role="alertdialog" aria-modal="true" aria-labelledby={`delete-title-${account.id}`}>
                    <h3 id={`delete-title-${account.id}`}>Удалить аккаунт LinkedIn?</h3>
                    <p>Будет отозван lease и удалена runtime-копия профиля. Email login перестанет быть доступен в реестре.</p>
                    <div>
                      <button className="admin-btn is-secondary" type="button" onClick={() => setConfirmDelete(undefined)}>Отмена</button>
                      <button className="admin-btn admin-btn--danger" type="button" onClick={() => void deleteAccount()}>Удалить аккаунт</button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
      <p className="admin-scope-note"><ShieldWarning size={18} aria-hidden="true" /> Обычные пользователи не получают этот раздел, его API или идентификаторы аккаунтов. LinkedIn source остаётся disabled без provider-permitted/official capability.</p>
    </section>
  );
}
