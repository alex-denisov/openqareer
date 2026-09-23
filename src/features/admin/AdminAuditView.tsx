import { useState, useEffect } from 'react';
import { ArrowClockwise, CaretDown, MagnifyingGlass } from '@phosphor-icons/react';
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
    <details className="admin-audit-row">
      <summary>
        <span className="admin-audit-row__date">{new Date(record.createdAt).toLocaleString('ru-RU')}</span>
        <span className="admin-audit-row__action">{formatAction(record.action)}</span>
        <span className="admin-audit-row__people">@{record.actorUsername}{record.subjectUsername ? ` → @${record.subjectUsername}` : ''}</span>
        <CaretDown size={18} aria-hidden="true" />
      </summary>
      <div className="admin-audit-row__detail">
        <p><strong>Кто:</strong> @{record.actorUsername}</p>
        <p><strong>Кого:</strong> {record.subjectUsername ? `@${record.subjectUsername}` : 'Без целевого пользователя'}</p>
        <p><strong>Детали:</strong> {record.detail || 'Не указаны'}</p>
      </div>
    </details>
  );
}

function AdminAuditTable({ records, total, offset, onOffset }: { records: AdminAuditRecord[]; total: number; offset: number; onOffset: (value: number) => void }) {
  return (
    <>
      <div className="admin-audit-list">{records.map((record) => <AdminAuditRow key={record.id} record={record} />)}</div>
      <nav className="admin-register-pager" aria-label="Страницы журнала">
        <button type="button" disabled={offset === 0} onClick={() => onOffset(Math.max(0, offset - 50))}>Назад</button>
        <span>Показано {offset + 1}–{offset + records.length} из {total}</span>
        <button type="button" disabled={offset + records.length >= total} onClick={() => onOffset(offset + 50)}>Далее</button>
      </nav>
    </>
  );
}

// eslint-disable-next-line max-lines-per-function -- this screen keeps its filters and paged event list together
export function AdminAuditView() {
  const [records, setRecords] = useState<AdminAuditRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [action, setAction] = useState('');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await listAdminAudit({ limit: 50, offset, query: submittedQuery, action, sortDirection });
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
  }, [action, offset, sortDirection, submittedQuery]);

  return (
    <div className="admin-audit-view">
      <div className="admin-section-header">
        <div>
          <p className="admin-eyebrow">Администрирование / безопасность</p>
          <h1 className="admin-section-title">Журнал действий</h1>
          <p className="admin-section-subtitle">Изменения ролей, тарифов, блокировок и входы в кабинеты пользователей.</p>
        </div>
      </div>

      <div className="admin-register-toolbar">
        <form className="admin-register-search" role="search" onSubmit={(event) => { event.preventDefault(); setOffset(0); setSubmittedQuery(query); }}>
          <label htmlFor="admin-audit-query">Поиск по участнику или деталям</label>
          <div><input id="admin-audit-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Логин или текст события" />
            <button className="admin-icon-btn" type="submit" aria-label="Найти в журнале" title="Найти"><MagnifyingGlass size={18} aria-hidden="true" /></button></div>
        </form>
        <div className="admin-register-chips" aria-label="Действие в журнале">
          {([['', 'Все'], ['change_user_role', 'Роли'], ['block_user', 'Блокировки'], ['reset_user_password', 'Пароли'], ['impersonate_user', 'Входы'], ['delete_user', 'Удаления']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={action === value} onClick={() => { setAction(value); setOffset(0); }}>{label}</button>
          ))}
        </div>
        <button className="admin-btn is-secondary" type="button" onClick={() => { setSortDirection((value) => value === 'desc' ? 'asc' : 'desc'); setOffset(0); }}>
          <ArrowClockwise size={18} aria-hidden="true" /> {sortDirection === 'desc' ? 'Сначала новые' : 'Сначала старые'}
        </button>
      </div>

      {error && <div className="admin-alert admin-alert--error">{error}</div>}

      {loading ? (
        <div className="admin-loading-state">Загрузка журнала...</div>
      ) : records.length > 0 ? (
        <AdminAuditTable records={records} total={total} offset={offset} onOffset={setOffset} />
      ) : (
        <div className="admin-empty-state">Журнал аудита пока пуст.</div>
      )}
    </div>
  );
}
