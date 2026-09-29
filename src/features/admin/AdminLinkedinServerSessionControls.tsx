import { CloudArrowUp, Trash } from '@phosphor-icons/react';
import type { LinkedinPoolAccount } from './linkedinPoolApi';

function formatSessionExpiry(value: string): string {
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

export function AdminLinkedinServerSessionMeta({
  account,
}: {
  readonly account: LinkedinPoolAccount;
}) {
  const session = account.serverSession;
  const sessionDate = session ? formatSessionExpiry(session.expiresAt) : '';
  const expiresAt = session ? Date.parse(session.expiresAt) : Number.NaN;
  const label = !session
    ? 'Нет'
    : expiresAt <= Date.now()
      ? `Истекла ${sessionDate}`
      : `До ${sessionDate}`;

  return (
    <div>
      <dt>Сессия на сервере</dt>
      <dd>{label}</dd>
    </div>
  );
}

function ClearLocalProfileButton({
  busy,
  pending,
  onClear,
}: {
  readonly busy: boolean;
  readonly pending: boolean;
  readonly onClear: () => void;
}) {
  return (
    <button
      className="admin-btn is-secondary"
      type="button"
      disabled={busy}
      onClick={onClear}
    >
      {pending ? 'Повторить очистку профиля на устройстве' : 'Очистить локальный профиль'}
    </button>
  );
}

export function AdminLinkedinServerSessionActions({
  account,
  canSave,
  canClearLocal,
  cleanupPending,
  busy,
  onSave,
  onClearLocal,
  onDelete,
}: {
  readonly account: LinkedinPoolAccount;
  readonly canSave: boolean;
  readonly canClearLocal: boolean;
  readonly cleanupPending: boolean;
  readonly busy: boolean;
  readonly onSave: () => void;
  readonly onClearLocal: () => void;
  readonly onDelete: () => void;
}) {
  return (
    <>
      {canSave ? (
        <button
          className="admin-btn is-secondary"
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={onSave}
        >
          <CloudArrowUp size={18} aria-hidden="true" />{' '}
          {busy ? 'Переносим сессию…' : 'Перенести сессию на сервер'}
        </button>
      ) : null}
      {canClearLocal ? (
        <ClearLocalProfileButton busy={busy} pending={cleanupPending} onClear={onClearLocal} />
      ) : null}
      {account.serverSession ? (
        <button
          className="admin-btn admin-btn--danger-outline"
          type="button"
          disabled={busy}
          onClick={onDelete}
        >
          <Trash size={18} aria-hidden="true" /> Удалить сессию с сервера
        </button>
      ) : null}
    </>
  );
}
