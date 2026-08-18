import { useState } from 'react';
import { ArrowsClockwise, CheckCircle, Warning, XCircle } from '@phosphor-icons/react';
import type { AdminVacancySource } from './adminApi';

interface AdminVacancySourcesViewProps {
  sources: AdminVacancySource[];
  loading: boolean;
  onRefresh: () => void;
  onSync: (sourceId: string) => Promise<void>;
}

function SourceStatusBadge({ status }: { status?: AdminVacancySource['lastStatus'] }) {
  if (status === 'healthy') {
    return (
      <span className="admin-badge is-success">
        <CheckCircle size={14} /> Активен
      </span>
    );
  }
  if (status === 'degraded') {
    return (
      <span className="admin-badge is-warning">
        <Warning size={14} /> Замедлен
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="admin-badge is-error">
        <XCircle size={14} /> Ошибка
      </span>
    );
  }
  return <span className="admin-badge is-muted">Не проверялся</span>;
}

function SourceCard({
  source,
  onSync,
}: {
  source: AdminVacancySource;
  onSync: (sourceId: string) => Promise<void>;
}) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    try {
      setSyncing(true);
      await onSync(source.id);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <article className="admin-source-card">
      <div className="admin-source-header">
        <div>
          <h3>{source.name}</h3>
          <span className="admin-source-type">Тип: {source.type}</span>
        </div>
        <SourceStatusBadge status={source.lastStatus} />
      </div>

      <p className="admin-source-url">{source.targetUrl}</p>

      <div className="admin-source-stats">
        <span>{source.itemsActiveTotal} активных</span>
        <span>•</span>
        <span>{source.itemsFoundTotal} всего найдено</span>
        <span>•</span>
        <span>Интервал: {source.refreshIntervalMinutes} мин</span>
      </div>

      <div className="admin-source-actions">
        <button
          className="admin-btn is-secondary"
          type="button"
          disabled={syncing}
          onClick={handleSync}
        >
          <ArrowsClockwise size={14} className={syncing ? 'is-spinning' : ''} />
          {syncing ? 'Синхронизация…' : 'Синхронизировать'}
        </button>
      </div>
    </article>
  );
}

export function AdminVacancySourcesView({
  sources,
  loading,
  onRefresh,
  onSync,
}: AdminVacancySourcesViewProps) {
  return (
    <div className="admin-vacancy-sources-view">
      <div className="admin-section-header">
        <div>
          <h2>Мультиисточниковый сбор вакансий</h2>
          <p className="admin-note">
            Управление парсерами, каналами Telegram, RSS-фидами и дедупликацией вакансий.
          </p>
        </div>
        <button
          className="admin-btn is-secondary"
          type="button"
          disabled={loading}
          onClick={onRefresh}
        >
          <ArrowsClockwise size={16} className={loading ? 'is-spinning' : ''} />
          Обновить статус
        </button>
      </div>

      <div className="admin-sources-grid">
        {sources.map((source) => (
          <SourceCard key={source.id} source={source} onSync={onSync} />
        ))}
      </div>
    </div>
  );
}
