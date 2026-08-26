import { useState } from 'react';
import {
  ArrowsClockwise,
  CheckCircle,
  MagnifyingGlass,
  Warning,
  X,
  XCircle,
} from '@phosphor-icons/react';
import {
  testAdminVacancySource,
  type AdminVacancySource,
  type VacancySourceTestItem,
  type VacancySourceTestResult,
} from './adminApi';

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

function SourceCardActions({
  syncing,
  onSync,
  onOpenTest,
}: {
  syncing: boolean;
  onSync: () => void;
  onOpenTest: () => void;
}) {
  return (
    <div className="admin-source-actions">
      <button
        className="admin-btn is-secondary"
        type="button"
        disabled={syncing}
        onClick={onSync}
      >
        <ArrowsClockwise size={14} className={syncing ? 'is-spinning' : ''} />
        {syncing ? 'Синхронизация…' : 'Синхронизировать'}
      </button>
      <button
        className="admin-btn is-secondary"
        type="button"
        onClick={onOpenTest}
      >
        <MagnifyingGlass size={14} />
        Проверить выдачу
      </button>
    </div>
  );
}

function SourceCard({
  source,
  onSync,
  onOpenTest,
}: {
  source: AdminVacancySource;
  onSync: (sourceId: string) => Promise<void>;
  onOpenTest: (source: AdminVacancySource) => void;
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

      <SourceCardActions
        syncing={syncing}
        onSync={handleSync}
        onOpenTest={() => onOpenTest(source)}
      />
    </article>
  );
}

function VacancyTestItemCard({ v }: { v: VacancySourceTestItem }) {
  return (
    <article className="admin-test-vacancy-item">
      <div className="admin-test-vacancy-item-header">
        <strong>{v.title}</strong>
        {v.salary ? (
          <span className="admin-badge is-success">
            {v.salary.from ? `от ${v.salary.from.toLocaleString('ru-RU')}` : ''}{' '}
            {v.salary.to ? `до ${v.salary.to.toLocaleString('ru-RU')}` : ''}{' '}
            {v.salary.currency ?? 'RUB'}
          </span>
        ) : null}
      </div>
      <div className="admin-test-vacancy-meta">
        <span>{v.company}</span> • <span>{v.location || 'Удаленно'}</span>
      </div>
      {v.requiredSkills && v.requiredSkills.length > 0 ? (
        <div className="admin-test-skills-list">
          {v.requiredSkills.map((s) => (
            <span key={s} className="admin-badge is-muted">{s}</span>
          ))}
        </div>
      ) : null}
      <div className="admin-test-link-wrap">
        <a href={v.url} target="_blank" rel="noreferrer" className="admin-primary-link">
          Открыть вакансию в источнике →
        </a>
      </div>
    </article>
  );
}

function VacancyTestResultsView({ result }: { result: VacancySourceTestResult }) {
  return (
    <div className="admin-test-results">
      <div className="admin-test-metrics">
        <span className={`admin-badge ${result.success ? 'is-success' : 'is-error'}`}>
          {result.success ? '200 OK' : 'Ошибка'}
        </span>
        <span>Время ответа: <strong>{result.latencyMs} мс</strong></span>
        <span>Найдено вакансий: <strong>{result.count}</strong></span>
      </div>

      {result.vacancies.length > 0 ? (
        <div className="admin-test-vacancies-list">
          {result.vacancies.map((v) => (
            <VacancyTestItemCard key={v.id} v={v} />
          ))}
        </div>
      ) : (
        <p className="admin-note is-empty-note">По запросу ничего не найдено.</p>
      )}
    </div>
  );
}

function VacancySourceTestHeader({
  name,
  targetUrl,
  onClose,
}: {
  name: string;
  targetUrl: string;
  onClose: () => void;
}) {
  return (
    <header className="admin-test-header">
      <div>
        <h3>Тест источника: {name}</h3>
        <p className="admin-note">
          Проверка реального ответа и инспекция спарсенных вакансий ({targetUrl})
        </p>
      </div>
      <button className="admin-quiet-button" type="button" onClick={onClose} aria-label="Закрыть">
        <X size={20} />
      </button>
    </header>
  );
}

function VacancySourceTestSearchForm({
  query,
  busy,
  onQueryChange,
  onSubmit,
}: {
  query: string;
  busy: boolean;
  onQueryChange: (val: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form className="admin-test-form" onSubmit={onSubmit}>
      <div className="admin-test-form-row">
        <input
          type="text"
          className="admin-input admin-test-query-input"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Поисковый запрос (например: React, QA, Team Lead)"
        />
        <button className="admin-btn is-secondary" type="submit" disabled={busy}>
          <MagnifyingGlass size={14} />
          {busy ? 'Выполняем запрос…' : 'Запустить тест'}
        </button>
      </div>
    </form>
  );
}

function VacancySourceTestModal({
  source,
  onClose,
}: {
  source: AdminVacancySource;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('Developer');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<VacancySourceTestResult>();
  const [error, setError] = useState<string>();

  const runTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const res = await testAdminVacancySource(source.id, { query: query.trim() || undefined });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при тестировании источника');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="admin-test-modal-backdrop" role="dialog" aria-modal="true">
      <div className="admin-test-modal">
        <VacancySourceTestHeader name={source.name} targetUrl={source.targetUrl} onClose={onClose} />
        <VacancySourceTestSearchForm query={query} busy={busy} onQueryChange={setQuery} onSubmit={runTest} />
        {error ? (
          <div className="admin-badge is-error admin-test-error" role="alert">
            {error}
          </div>
        ) : null}
        {result ? <VacancyTestResultsView result={result} /> : null}
      </div>
    </div>
  );
}

export function AdminVacancySourcesView({
  sources,
  loading,
  onRefresh,
  onSync,
}: AdminVacancySourcesViewProps) {
  const [testingSource, setTestingSource] = useState<AdminVacancySource | null>(null);

  return (
    <div className="admin-vacancy-sources-view">
      <div className="admin-section-header">
        <div>
          <h2>Мультиисточниковый сбор вакансий</h2>
          <p className="admin-note">
            Управление парсерами, каналами Telegram, RSS-фидами, дедупликацией и интерактивное тестирование выдачи.
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
          <SourceCard
            key={source.id}
            source={source}
            onSync={onSync}
            onOpenTest={(src) => setTestingSource(src)}
          />
        ))}
      </div>

      {testingSource ? (
        <VacancySourceTestModal
          source={testingSource}
          onClose={() => setTestingSource(null)}
        />
      ) : null}
    </div>
  );
}
