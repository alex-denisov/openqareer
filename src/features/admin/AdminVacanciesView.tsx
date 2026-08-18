import React, { useState, useEffect, useCallback } from 'react';
import {
  listAdminVacancies,
  syncAllAdminVacancySources,
  type AdminVacancy,
  type AdminVacancyPage,
} from './adminApi';

type RemoteFilter = 'all' | 'remote' | 'office';

function formatSalary(salary?: AdminVacancy['salary']): string {
  if (!salary) return 'Зарплата не указана';
  const parts: string[] = [];
  if (salary.from) parts.push(`от ${salary.from.toLocaleString()}`);
  if (salary.to) parts.push(`до ${salary.to.toLocaleString()}`);
  parts.push(salary.currency);
  if (salary.gross) parts.push('(до вычета)');
  return parts.join(' ');
}

// ---------- Stats ----------

function VacancyStatsGrid({ data }: { data: AdminVacancyPage }) {
  const remoteCount = data.items.filter((i) => i.isRemote).length;
  return (
    <div className="admin-stats-grid">
      <div className="admin-stat-card">
        <span className="admin-stat-card__value">{data.total}</span>
        <span className="admin-stat-card__label">Всего вакансий в выборке</span>
      </div>
      <div className="admin-stat-card">
        <span className="admin-stat-card__value">18</span>
        <span className="admin-stat-card__label">Активных подключенных каналов</span>
      </div>
      <div className="admin-stat-card">
        <span className="admin-stat-card__value">{remoteCount}</span>
        <span className="admin-stat-card__label">Удаленный формат</span>
      </div>
    </div>
  );
}

// ---------- Filters ----------

function VacancyFilters({
  searchQuery, onSearchChange, selectedSource, onSourceChange,
  selectedRemote, onRemoteChange, sources,
}: {
  searchQuery: string; onSearchChange: (v: string) => void;
  selectedSource: string; onSourceChange: (v: string) => void;
  selectedRemote: RemoteFilter; onRemoteChange: (v: RemoteFilter) => void;
  sources?: Array<{ sourceId: string; sourceName: string; count: number }>;
}) {
  return (
    <div className="admin-vacancies-controls">
      <div className="admin-search-wrapper">
        <input type="text" className="admin-input" placeholder="Поиск по должности, компании, навыкам..." value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} />
      </div>
      <div className="admin-filter-group">
        <select className="admin-select" value={selectedSource} onChange={(e) => onSourceChange(e.target.value)}>
          <option value="all">Все источники</option>
          {sources?.map((s) => (
            <option key={s.sourceId} value={s.sourceId}>{s.sourceName} ({s.count})</option>
          ))}
        </select>
        <select className="admin-select" value={selectedRemote} onChange={(e) => onRemoteChange(e.target.value as RemoteFilter)}>
          <option value="all">Формат: Все</option>
          <option value="remote">Только Remote</option>
          <option value="office">Офис / Гибрид</option>
        </select>
      </div>
    </div>
  );
}

// ---------- Vacancy card ----------

function VacancyCardSkills({ skills }: { skills: string[] }) {
  if (skills.length === 0) return null;
  return (
    <div className="admin-vacancy-skills">
      {skills.slice(0, 6).map((skill, idx) => (
        <span key={idx} className="admin-skill-chip">{skill}</span>
      ))}
    </div>
  );
}

function VacancyCard({ vacancy, onSelect }: { vacancy: AdminVacancy; onSelect: (v: AdminVacancy) => void }) {
  return (
    <article className="admin-vacancy-card">
      <div className="admin-vacancy-card__header">
        <div className="admin-vacancy-card__title-row">
          <h3 className="admin-vacancy-card__title">{vacancy.title}</h3>
          <span className="admin-source-badge admin-source-badge--active">{vacancy.provenance.sourceId}</span>
        </div>
        <div className="admin-vacancy-card__meta">
          <span className="admin-vacancy-company">{vacancy.company}</span>
          <span className="admin-dot-sep">•</span>
          <span className="admin-vacancy-location">{vacancy.location}</span>
          {vacancy.isRemote && <span className="admin-badge admin-badge--pro">Remote</span>}
        </div>
      </div>
      <div className="admin-vacancy-salary">{formatSalary(vacancy.salary)}</div>
      <p className="admin-vacancy-desc">{vacancy.description}</p>
      {vacancy.requiredSkills && <VacancyCardSkills skills={vacancy.requiredSkills} />}
      <VacancyCardFooter vacancy={vacancy} onSelect={onSelect} />
    </article>
  );
}

function VacancyCardFooter({ vacancy, onSelect }: { vacancy: AdminVacancy; onSelect: (v: AdminVacancy) => void }) {
  return (
    <div className="admin-vacancy-card__footer">
      <span className="admin-vacancy-date">
        Опубликовано: {new Date(vacancy.publishedAt).toLocaleDateString('ru-RU')}
      </span>
      <div className="admin-vacancy-card__actions">
        <button type="button" className="admin-btn admin-btn--secondary" onClick={() => onSelect(vacancy)}>
          Подробнее
        </button>
        <a href={vacancy.url} target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn--outline">
          Открыть на источнике ↗
        </a>
      </div>
    </div>
  );
}

// ---------- Detail modal ----------

function VacancyDetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="admin-detail-row">
      <span className="admin-detail-label">{label}</span>
      <span className="admin-detail-val">{children}</span>
    </div>
  );
}

function VacancyDetailModal({ vacancy, onClose }: { vacancy: AdminVacancy; onClose: () => void }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div className="admin-modal-overlay" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <button type="button" className="admin-modal-backdrop" aria-label="Закрыть" onClick={onClose} tabIndex={-1} />
      <div className="admin-modal">
        <div className="admin-modal__header">
          <h3 className="admin-modal__title">{vacancy.title}</h3>
          <button type="button" className="admin-modal__close" onClick={onClose}>✕</button>
        </div>
        <VacancyDetailBody vacancy={vacancy} />
        <div className="admin-modal__footer">
          <a href={vacancy.url} target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn--primary">
            Перейти к оригиналу вакансии ↗
          </a>
          <button type="button" className="admin-btn admin-btn--secondary" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
}

function VacancyDetailBody({ vacancy }: { vacancy: AdminVacancy }) {
  return (
    <div className="admin-modal__body">
      <VacancyDetailRow label="Компания:">{vacancy.company}</VacancyDetailRow>
      <VacancyDetailRow label="Зарплата:">{formatSalary(vacancy.salary)}</VacancyDetailRow>
      <VacancyDetailRow label="Локация / Формат:">
        {vacancy.location} {vacancy.isRemote ? '(Remote)' : ''}
      </VacancyDetailRow>
      <VacancyDetailRow label="Источник:">
        {vacancy.provenance.sourceId} ({vacancy.provenance.sourceType})
      </VacancyDetailRow>
      <div className="admin-detail-row">
        <span className="admin-detail-label">Навыки:</span>
        <div className="admin-vacancy-skills">
          {vacancy.requiredSkills?.map((s, i) => (
            <span key={i} className="admin-skill-chip">{s}</span>
          ))}
        </div>
      </div>
      <div className="admin-detail-section">
        <span className="admin-detail-label">Описание:</span>
        <div className="admin-detail-text">{vacancy.description}</div>
      </div>
    </div>
  );
}

// ---------- Header ----------

function VacanciesHeader({ syncing, onSyncAll }: { syncing: boolean; onSyncAll: () => void }) {
  return (
    <div className="admin-vacancies-header">
      <div>
        <h2 className="admin-section-title">База вакансий всех источников</h2>
        <p className="admin-section-subtitle">
          Агрегация, валидация и мониторинг качества вакансий из 18+ каналов (API, биржи, Telegram)
        </p>
      </div>
      <button type="button" className="admin-btn admin-btn--primary" onClick={onSyncAll} disabled={syncing}>
        {syncing ? 'Синхронизация...' : '🔄 Синхронизировать все источники'}
      </button>
    </div>
  );
}

// ---------- List ----------

function VacanciesList({ items, onSelect }: { items: AdminVacancy[]; onSelect: (v: AdminVacancy) => void }) {
  if (items.length === 0) {
    return <div className="admin-empty-state">По выбранным фильтрам вакансий не найдено.</div>;
  }
  return (
    <div className="admin-vacancies-list">
      {items.map((vacancy) => (
        <VacancyCard key={vacancy.id} vacancy={vacancy} onSelect={onSelect} />
      ))}
    </div>
  );
}

// ---------- Root export ----------

function useVacancyLoader(selectedSource: string, searchQuery: string, selectedRemote: RemoteFilter) {
  const [data, setData] = useState<AdminVacancyPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVacancies = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listAdminVacancies({
        sourceId: selectedSource !== 'all' ? selectedSource : undefined,
        query: searchQuery || undefined,
        isRemote: selectedRemote === 'remote' ? true : selectedRemote === 'office' ? false : undefined,
        limit: 50,
      });
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить вакансии');
    } finally {
      setLoading(false);
    }
  }, [selectedSource, searchQuery, selectedRemote]);

  useEffect(() => { fetchVacancies(); }, [fetchVacancies]);

  return { data, loading, error, setError, fetchVacancies };
}

export function AdminVacanciesView() {
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedRemote, setSelectedRemote] = useState<RemoteFilter>('all');
  const [selectedVacancy, setSelectedVacancy] = useState<AdminVacancy | null>(null);
  const { data, loading, error, setError, fetchVacancies } = useVacancyLoader(selectedSource, searchQuery, selectedRemote);

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      await syncAllAdminVacancySources();
      await fetchVacancies();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка при синхронизации');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="admin-vacancies-view">
      <VacanciesHeader syncing={syncing} onSyncAll={handleSyncAll} />
      {data && <VacancyStatsGrid data={data} />}
      <VacancyFilters searchQuery={searchQuery} onSearchChange={setSearchQuery} selectedSource={selectedSource} onSourceChange={setSelectedSource} selectedRemote={selectedRemote} onRemoteChange={setSelectedRemote} sources={data?.statsBySource} />
      {error && <div className="admin-alert admin-alert--error">{error}</div>}
      {loading ? <div className="admin-loading-state">Загрузка вакансий...</div> : data ? <VacanciesList items={data.items} onSelect={setSelectedVacancy} /> : null}
      {selectedVacancy && <VacancyDetailModal vacancy={selectedVacancy} onClose={() => setSelectedVacancy(null)} />}
    </div>
  );
}
