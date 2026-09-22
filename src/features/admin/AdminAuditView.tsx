import React, { useState, useEffect } from 'react';
import { listAdminAudit, type AdminAuditRecord } from './adminApi';

function formatAction(action: string) {
  switch (action) {
    case 'change_user_role': return 'Смена роли пользователя';
    case 'block_user': return 'Блокировка аккаунта';
    case 'unblock_user': return 'Разблокировка аккаунта';
    case 'update_user_profile': return 'Редактирование профиля/подписки';
    case 'reset_user_password': return 'Сброс пароля администратором';
    case 'impersonate_user': return 'Имперсонация (вход в профиль)';
    case 'delete_user': return 'Удаление пользователя';
    default: return action;
  }
}

function AdminAuditRow({ record }: { record: AdminAuditRecord }) {
  return (
    <tr>
      <td className="admin-table__date">
        {new Date(record.createdAt).toLocaleString('ru-RU')}
      </td>
      <td>
        <span className="admin-tag admin-tag--admin">@{record.actorUsername}</span>
      </td>
      <td className="admin-table__action">{formatAction(record.action)}</td>
      <td>
        {record.subjectUsername ? (
          <span className="admin-tag">@{record.subjectUsername}</span>
        ) : (
          '—'
        )}
      </td>
      <td className="admin-table__detail">{record.detail || '—'}</td>
    </tr>
  );
}

function AdminAuditTable({ records, total }: { records: AdminAuditRecord[]; total: number }) {
  return (
    <div className="admin-audit-table-wrapper">
      <table className="admin-table">
        <thead>
          <tr>
            <th>Дата и время</th>
            <th>Администратор</th>
            <th>Действие</th>
            <th>Целевой пользователь</th>
            <th>Детали</th>
          </tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <AdminAuditRow key={r.id} record={r} />
          ))}
        </tbody>
      </table>
      <div className="admin-table__footer">Всего записей: {total}</div>
    </div>
  );
}

export function AdminAuditView() {
  const [records, setRecords] = useState<AdminAuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await listAdminAudit({ limit: 50 });
        if (!cancelled) {
          setRecords(res.records);
          setTotal(res.total);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Не удалось загрузить журнал аудита');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="admin-audit-view">
      <div className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Администрирование / безопасность</p>
          <h1 className="admin-section-title">Журнал действий</h1>
          <p className="admin-section-subtitle">Изменения ролей, тарифов, блокировок и входы в кабинеты пользователей.</p>
        </div>
      </div>

      {error && <div className="admin-alert admin-alert--error">{error}</div>}

      {loading ? (
        <div className="admin-loading-state">Загрузка журнала...</div>
      ) : records.length > 0 ? (
        <AdminAuditTable records={records} total={total} />
      ) : (
        <div className="admin-empty-state">Журнал аудита пока пуст.</div>
      )}
    </div>
  );
}
