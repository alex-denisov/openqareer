import { useState, useEffect, useCallback } from 'react';
import { employerLabel } from '../../../shared/employerLabel';
import {
  listAdminVacancies,
  syncAllAdminVacancySources,
  type AdminVacancyPage,
  type AdminVacancySummary,
} from './adminApi';
import { VacancyDetailModal } from './VacancyDetailModal';

type RemoteFilter = 'all' | 'remote' | 'office';

function formatSalary(salary?: AdminVacancySummary['salary']): string {
  if (!salary) return 'Зарплата не указана';
  const parts: string[] = [];
  if (salary.from) parts.push(`от ${salary.from.toLocaleString()}`);
  if (salary.to) parts.push(`до ${salary.to.toLocaleString()}`);
  parts.push(salary.currency);
  if (salary.gross) parts.push('(до вычета)');
  return parts.join(' ');
}

// ---------- Stats & Filters ----------

/**
 * Числа называют свой знаменатель. «18 активных каналов» стояло литералом в
 * разметке, а «удалённый формат» считался по загруженной странице и выдавался
 * за счёт по всей выборке — тот же запрет выдуманных чисел, что в PRB-016.
 */
function VacancyStatsGrid({ data }: { data: AdminVacancyPage }) {
  const remoteCount = data.items.filter((i) => i.isRemote).length;
  const sourcesWithRecords = data.statsBySource.filter((s) => s.count > 0).length;
  return (
    <div className="admin-stats-grid">
      <div className="admin-stat-card">
        <span className="admin-stat-card__value">{data.total}</span>
        <span className="admin-stat-card__label">Всего вакансий в выборке</span>
      </div>
      <div className="admin-stat-card">
        <span className="admin-stat-card__value">
          {sourcesWithRecords} из {data.statsBySource.length}
        </span>
        <span className="admin-stat-card__label">Источников с записями в пуле</span>
      </div>
      <div className="admin-stat-card">
        <span className="admin-stat-card__value">
          {remoteCount} из {data.items.length}
        </span>
        <span className="admin-stat-card__label">Удалённых на этой странице</span>
      </div>
    </div>
  );
}

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
        <input type="text" className="admin-input" placeholder="Поиск по должности, компании, навыкам, ID..." value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} />
      </div>
      <div className="admin-filter-group">
        <select className="admin-select" value={selectedSource} onChange={(e) => onSourceChange(e.target.value)}>
          <option value="all">Все источники (18+)</option>
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

// ---------- Vacancy Card ----------

function VacancyCardMeta({ vacancy }: { vacancy: AdminVacancySummary }) {
  return (
    <div className="admin-vacancy-card__meta">
      <span className="admin-vacancy-company">{employerLabel(vacancy.company)}</span>
      <span className="admin-dot-sep">•</span>
      <span className="admin-vacancy-location">{vacancy.location}</span>
      {vacancy.isRemote && <span className="admin-badge admin-badge--pro">Remote</span>}
      {vacancy.experienceLevel && <span className="admin-badge admin-badge--info">{vacancy.experienceLevel}</span>}
    </div>
  );
}

function VacancyCard({ vacancy, onSelect }: { vacancy: AdminVacancySummary; onSelect: (v: AdminVacancySummary) => void }) {
  return (
    <article className="admin-vacancy-card">
      <div className="admin-vacancy-card__header">
        <div className="admin-vacancy-card__title-row">
          <h3 className="admin-vacancy-card__title">{vacancy.title}</h3>
          <div className="admin-vacancy-badges">
            <span className="admin-vacancy-id-chip">ID: {vacancy.id}</span>
            <span className="admin-source-badge admin-source-badge--active">{vacancy.provenance.sourceId}</span>
          </div>
        </div>
        <VacancyCardMeta vacancy={vacancy} />
      </div>
      <div className="admin-vacancy-salary">{formatSalary(vacancy.salary)}</div>
      <p className="admin-vacancy-desc">{vacancy.descriptionSnippet}</p>
      {vacancy.requiredSkills && vacancy.requiredSkills.length > 0 && (
        <div className="admin-vacancy-skills">
          {vacancy.requiredSkills.map((s, idx) => (
            <span key={idx} className="admin-skill-chip">{s}</span>
          ))}
          {vacancy.skillCount > vacancy.requiredSkills.length && (
            <span className="admin-skill-chip">
              +{vacancy.skillCount - vacancy.requiredSkills.length}
            </span>
          )}
        </div>
      )}
      <VacancyCardFooter vacancy={vacancy} onSelect={onSelect} />
    </article>
  );
}

function VacancyCardFooter({ vacancy, onSelect }: { vacancy: AdminVacancySummary; onSelect: (v: AdminVacancySummary) => void }) {
  return (
    <div className="admin-vacancy-card__footer">
      <span className="admin-vacancy-date">
        Опубликовано: {new Date(vacancy.publishedAt).toLocaleDateString('ru-RU')}
      </span>
      <div className="admin-vacancy-card__actions">
        <button type="button" className="admin-btn admin-btn--secondary" onClick={() => onSelect(vacancy)}>
          Подробнее & Структура
        </button>
        <a href={vacancy.url} target="_blank" rel="noopener noreferrer" className="admin-btn admin-btn--outline">
          Источник ↗
        </a>
      </div>
    </div>
  );
}

// ---------- Header & List ----------

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

function VacanciesList({ items, onSelect }: { items: AdminVacancySummary[]; onSelect: (v: AdminVacancySummary) => void }) {
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

// ---------- Data Loading Hook ----------

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

function useVacancyUrlSync(
  data: AdminVacancyPage | null,
  selectedVacancy: AdminVacancySummary | null,
  setSelectedVacancy: (v: AdminVacancySummary | null) => void,
) {
  useEffect(() => {
    if (data?.items && typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlVacId = params.get('vacancyId');
      if (urlVacId && !selectedVacancy) {
        const found = data.items.find((i) => i.id === urlVacId);
        if (found) setSelectedVacancy(found);
      }
    }
  }, [data, selectedVacancy, setSelectedVacancy]);

  return (v: AdminVacancySummary | null) => {
    setSelectedVacancy(v);
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (v) {
        params.set('tab', 'vacancies');
        params.set('vacancyId', v.id);
      } else {
        params.delete('vacancyId');
      }
      const query = params.toString();
      window.history.replaceState(null, '', query ? `/admin?${query}` : '/admin');
    }
  };
}

// ---------- Root Export ----------

export function AdminVacanciesView() {
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedRemote, setSelectedRemote] = useState<RemoteFilter>('all');
  const [selectedVacancy, setSelectedVacancy] = useState<AdminVacancySummary | null>(null);
  const { data, loading, error, setError, fetchVacancies } = useVacancyLoader(selectedSource, searchQuery, selectedRemote);
  const handleSelectVacancy = useVacancyUrlSync(data, selectedVacancy, setSelectedVacancy);

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
      <VacancyFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedSource={selectedSource}
        onSourceChange={setSelectedSource}
        selectedRemote={selectedRemote}
        onRemoteChange={setSelectedRemote}
        sources={data?.statsBySource}
      />
      {error && <div className="admin-alert admin-alert--error">{error}</div>}
      {loading ? <div className="admin-loading-state">Загрузка вакансий...</div> : data ? <VacanciesList items={data.items} onSelect={handleSelectVacancy} /> : null}
      {selectedVacancy && (
        <VacancyDetailModal vacancyId={selectedVacancy.id} onClose={() => handleSelectVacancy(null)} />
      )}
    </div>
  );
}
