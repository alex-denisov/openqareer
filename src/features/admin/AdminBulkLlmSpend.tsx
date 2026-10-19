import { useEffect, useState } from 'react';
import { apiFetch, readData } from '../coach/apiClient';
interface SpendStatus {
  enabled: boolean;
  spentUsd: number;
  heldUsd: number;
  remainingUsd: number;
  dayRemainingUsd?: number;
  limits: { runUsd: number; dayUsd: number; totalUsd: number; perRequestUsd: number } | null;
  events: Array<{ kind: string; created_at: string }>;
}
function usd(value: number) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 6,
  }).format(value);
}
const EVENTS: Record<string, string> = {
  budget_exceeded: 'Достигнут лимит расходов',
  cost_exceeds_reservation: 'Стоимость выше резерва: новые запросы остановлены',
  completion_failed_or_unknown: 'Вызов завершился ошибкой или требует сверки стоимости',
  batch_submission_unknown: 'Нужно проверить приём пакетного запроса',
  batch_terminal_usage_unresolved: 'Пакет завершён без подтверждённой стоимости',
};
function useBulkSpend() {
  const [data, setData] = useState<SpendStatus>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true);
    setError(false);
    void apiFetch('/api/admin/llm-spend', { signal: abort.signal })
      .then(readData<SpendStatus>)
      .then((value) => {
        if (!abort.signal.aborted) setData(value);
      })
      .catch(() => {
        if (!abort.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [revision]);
  return { data, loading, error, refresh: () => setRevision((value) => value + 1) };
}
function SpendNumbers({ data }: { readonly data: SpendStatus }) {
  return (
    <>
      <dl className="admin-register-toolbar">
        <div>
          <dt>Потрачено</dt>
          <dd>{usd(data.spentUsd)}</dd>
        </div>
        <div>
          <dt>Зарезервировано</dt>
          <dd>{usd(data.heldUsd)}</dd>
        </div>
        <div>
          <dt>Общий остаток</dt>
          <dd>{data.limits ? usd(data.remainingUsd) : 'Лимит не настроен'}</dd>
        </div>
        <div>
          <dt>Остаток на сутки</dt>
          <dd>
            {data.dayRemainingUsd === undefined || !data.limits
              ? 'Лимит не настроен'
              : usd(data.dayRemainingUsd)}
          </dd>
        </div>
      </dl>
      {data.limits ? (
        <p>
          Лимит запуска: {usd(data.limits.runUsd)} · Суток: {usd(data.limits.dayUsd)} · Общий:{' '}
          {usd(data.limits.totalUsd)}
        </p>
      ) : null}
    </>
  );
}
function SpendEvents({ events }: { readonly events: SpendStatus['events'] }) {
  return events.length ? (
    <ul>
      {events.map((event, index) => (
        <li key={`${event.created_at}:${index}`}>
          {EVENTS[event.kind] ?? 'Событие расчётов'} ·{' '}
          {new Date(event.created_at).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
        </li>
      ))}
    </ul>
  ) : (
    <p>Событий ограничения расходов пока нет.</p>
  );
}
export function AdminBulkLlmSpend() {
  const { data, loading, error, refresh } = useBulkSpend();
  return (
    <section
      className="admin-audit-view admin-bulk-spend"
      aria-label="Расходы массовых расчётов"
      aria-busy={loading}
    >
      <h2>Расходы массовых расчётов</h2>
      {loading ? <p role="status">Загружаем расходы…</p> : null}
      {error ? (
        <p className="admin-error" role="alert">
          Не удалось получить расходы. Данные требуют обновления.
        </p>
      ) : null}
      {data ? (
        <>
          <p>{data.enabled ? 'Клиент расчётов включён' : 'Клиент расчётов выключен'}</p>
          <SpendNumbers data={data} />
          <SpendEvents events={data.events} />
        </>
      ) : null}
      <button className="admin-btn is-secondary" type="button" disabled={loading} onClick={refresh}>
        Обновить расходы
      </button>
    </section>
  );
}
