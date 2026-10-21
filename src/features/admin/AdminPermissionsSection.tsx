import { useCallback, useEffect, useState } from 'react';
import {
  ADMIN_PERMISSION_KEYS,
  getAdminPermissionSnapshot,
  setAdminUserPermission,
  type AdminPermission,
  type AdminPermissionSnapshot,
} from './adminApi';

const ADMIN_PERMISSION_LABELS: Record<AdminPermission, string> = {
  can_view_candidates: 'Просмотр закреплённых кандидатов',
  can_edit_campaigns: 'Редактирование кампаний',
  can_manage_pool: 'Управление пулом и источниками',
  can_view_audit: 'Просмотр журнала аудита',
};

function extractError(reason: unknown): string {
  return reason instanceof Error ? reason.message : 'Неизвестная ошибка';
}

function useAdminPermissionSnapshot(userId: string, refreshKey: number) {
  const [snapshot, setSnapshot] = useState<AdminPermissionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<AdminPermission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    getAdminPermissionSnapshot(userId)
      .then((next) => {
        if (active) setSnapshot(next);
      })
      .catch((reason: unknown) => {
        if (active) setError(extractError(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, userId]);

  const toggle = useCallback(
    async (permission: AdminPermission, enabled: boolean) => {
      if (!snapshot) return;
      const before = snapshot;
      setSnapshot({
        ...snapshot,
        overrides: { ...snapshot.overrides, [permission]: enabled },
        permissions: { ...snapshot.permissions, [permission]: enabled },
      });
      setPending(permission);
      setError(null);
      setSaved(false);
      try {
        setSnapshot(await setAdminUserPermission(userId, permission, enabled));
        setSaved(true);
      } catch (reason: unknown) {
        setSnapshot(before);
        setError(extractError(reason));
      } finally {
        setPending(null);
      }
    },
    [snapshot, userId],
  );

  return { snapshot, loading, pending, error, saved, toggle };
}

export function AdminPermissionsSection({ userId }: { userId: string }) {
  const [retryKey, setRetryKey] = useState(0);
  const permissions = useAdminPermissionSnapshot(userId, retryKey);
  if (permissions.loading)
    return (
      <p className="admin-note" aria-busy="true">
        Загружаем права…
      </p>
    );
  if (!permissions.snapshot) {
    return (
      <div className="admin-alert admin-alert--error" role="alert">
        <span>{permissions.error ?? 'Права недоступны.'}</span>
        <button
          type="button"
          className="admin-quiet-button"
          onClick={() => setRetryKey((key) => key + 1)}
        >
          Повторить
        </button>
      </div>
    );
  }
  return (
    <section className="admin-rbac-section" aria-labelledby="admin-permissions-title">
      <h4 id="admin-permissions-title" className="admin-rbac-section__title">
        Права доступа
      </h4>
      <PermissionRows
        snapshot={permissions.snapshot}
        pending={permissions.pending !== null}
        onToggle={permissions.toggle}
      />
      {permissions.saved && (
        <p className="admin-rbac-status" role="status">
          Право сохранено.
        </p>
      )}
      {permissions.error && (
        <p className="admin-alert admin-alert--error" role="alert">
          {permissions.error}
        </p>
      )}
    </section>
  );
}

function PermissionRows({
  snapshot,
  pending,
  onToggle,
}: {
  snapshot: AdminPermissionSnapshot;
  pending: boolean;
  onToggle: (permission: AdminPermission, enabled: boolean) => void;
}) {
  return (
    <fieldset className="admin-permission-grid" disabled={pending} aria-busy={pending}>
      <legend className="admin-visually-hidden">Гранулярные права пользователя</legend>
      {ADMIN_PERMISSION_KEYS.map((permission) => (
        <div className="admin-permission-option" key={permission}>
          <input
            id={`admin-permission-${permission}`}
            type="checkbox"
            checked={snapshot.permissions[permission]}
            onChange={(event) => onToggle(permission, event.currentTarget.checked)}
          />
          <label
            className="admin-permission-option__copy"
            htmlFor={`admin-permission-${permission}`}
          >
            <span>{ADMIN_PERMISSION_LABELS[permission]}</span>
            <small>
              {permission in snapshot.overrides ? 'Индивидуальное право' : 'По умолчанию роли'}
            </small>
          </label>
        </div>
      ))}
    </fieldset>
  );
}
