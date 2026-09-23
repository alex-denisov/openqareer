import { useState, useEffect, useCallback, useRef } from 'react';
import { ArrowSquareOut, CaretDown, MagnifyingGlass } from '@phosphor-icons/react';
import { employerLabel } from '../../../shared/employerLabel';
import {
  listAdminVacancies,
  syncAllAdminVacancySources,
  type AdminVacancyPage,
  type AdminVacancySummary,
} from './adminApi';
import { VacancyDetailModal } from './VacancyDetailModal';
import { sourceCountLabel } from './sourceCountLabel';

type RemoteFilter = 'all' | 'remote' | 'office';
type VacancySortKey = 'title' | 'company' | 'source' | 'location' | 'salary' | 'published';

function sortVacancies(items: readonly AdminVacancySummary[], key: VacancySortKey, descending: boolean): AdminVacancySummary[] {
  const value = (item: AdminVacancySummary): string | number => {
    switch (key) {
      case 'title': return item.title;
      case 'company': return employerLabel(item.company);
      case 'source': return item.provenance.sourceId;
      case 'location': return item.location ?? '';
      case 'salary': return item.salary?.from ?? item.salary?.to ?? 0;
      case 'published': return item.publishedAt;
    }
  };
  return [...items].sort((left, right) => {
    const a = value(left);
    const b = value(right);
    const order = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ru-RU');
    return (descending ? -order : order) || left.id.localeCompare(right.id);
  });
}

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

/** Число источников в подписи — настоящее или его нет вовсе (B212, PRB-024). */
function SourceSelect({
  value, onChange, sources,
}: {
  value: string; onChange: (v: string) => void;
  sources?: Array<{ sourceId: string; sourceName: string; count: number }>;
}) {
  const [needle, setNeedle] = useState('');
  const pickerRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) pickerRef.current.open = false;
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && pickerRef.current?.open) {
        pickerRef.current.open = false;
        pickerRef.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);
  const named = sourceCountLabel(sources);
  const current = sources?.find((source) => source.sourceId === value);
  const options = sources?.filter((source) => source.sourceName.toLocaleLowerCase('ru-RU').includes(needle.toLocaleLowerCase('ru-RU')) || source.sourceId.toLocaleLowerCase('ru-RU').includes(needle.toLocaleLowerCase('ru-RU'))) ?? [];
  return (
    <details className="admin-source-picker" ref={pickerRef}>
      <summary>{current ? current.sourceName : named === null ? 'Все источники' : `Все источники (${named})`} <CaretDown size={16} aria-hidden="true" /></summary>
      <div className="admin-source-picker__menu">
        <label>Найти источник<input type="search" value={needle} onChange={(event) => setNeedle(event.target.value)} placeholder="Название или ID" /></label>
        <div className="admin-source-picker__options">
          <button type="button" aria-pressed={value === 'all'} onClick={(event) => { onChange('all'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Все источники</button>
          {options.map((source) => (
            <button key={source.sourceId} type="button" aria-pressed={value === source.sourceId} onClick={(event) => { onChange(source.sourceId); event.currentTarget.closest('details')?.removeAttribute('open'); }}>
              <span>{source.sourceName}</span><small>{source.count}</small>
            </button>
          ))}
        </div>
      </div>
    </details>
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
        <MagnifyingGlass size={18} aria-hidden="true" />
        <input type="search" className="admin-input" aria-label="Поиск вакансий" placeholder="Должность, компания, навык или ID" value={searchQuery} onChange={(e) => onSearchChange(e.target.value)} />
      </div>
      <div className="admin-filter-group">
        <SourceSelect value={selectedSource} onChange={onSourceChange} sources={sources} />
        <div className="admin-register-chips" aria-label="Формат работы">
          {([['all', 'Все'], ['remote', 'Удалённо'], ['office', 'Офис / гибрид']] as const).map(([value, label]) => (
            <button key={value} type="button" aria-pressed={selectedRemote === value} onClick={() => onRemoteChange(value)}>{label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------- Compact vacancy register ----------

function VacancyCard({ vacancy, onSelect }: { vacancy: AdminVacancySummary; onSelect: (v: AdminVacancySummary) => void }) {
  return (
    <article className="admin-vacancy-row">
      <div className="admin-vacancy-row__main">
        <button type="button" onClick={() => onSelect(vacancy)}>{vacancy.title}</button>
        <small>{employerLabel(vacancy.company)} · {vacancy.id}</small>
      </div>
      <span className="admin-vacancy-row__source" title={vacancy.provenance.sourceId}>{vacancy.provenance.sourceId}</span>
      <span className="admin-vacancy-row__place">{vacancy.location || 'Место не указано'}<small>{vacancy.isRemote ? 'Удалённо' : 'Офис / гибрид'}{vacancy.experienceLevel ? ` · ${vacancy.experienceLevel}` : ''}</small></span>
      <span className="admin-vacancy-row__salary">{formatSalary(vacancy.salary)}</span>
      <time className="admin-vacancy-row__date" dateTime={vacancy.publishedAt}>{new Date(vacancy.publishedAt).toLocaleDateString('ru-RU')}</time>
      <a className="admin-icon-btn" href={vacancy.url} target="_blank" rel="noopener noreferrer" aria-label={`Открыть источник вакансии ${vacancy.title}`} title="Открыть источник"><ArrowSquareOut size={18} aria-hidden="true" /></a>
    </article>
  );
}

// ---------- Header & List ----------

function VacanciesHeader({ syncing, onSyncAll, sourcesNamed }: { syncing: boolean; onSyncAll: () => void; sourcesNamed: string | null }) {
  return (
    <div className="admin-vacancies-header">
      <div>
        <p className="admin-eyebrow">Администрирование / каталог</p>
        <h1 className="admin-section-title">База вакансий</h1>
        <p className="admin-section-subtitle">
          {sourcesNamed === null
            ? 'Поиск и проверка записей из подключённых источников.'
            : `Поиск и проверка записей из ${sourcesNamed} источников.`}
        </p>
      </div>
      <button type="button" className="admin-btn admin-btn--primary" onClick={onSyncAll} disabled={syncing}>
        {syncing ? 'Синхронизация…' : 'Синхронизировать все источники'}
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

function useVacancyLoader(selectedSource: string, searchQuery: string, selectedRemote: RemoteFilter, offset: number) {
  const [data, setData] = useState<AdminVacancyPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestNumber = useRef(0);

  const fetchVacancies = useCallback(async () => {
    const currentRequest = ++requestNumber.current;
    setLoading(true);
    setError(null);
    try {
      const res = await listAdminVacancies({
        sourceId: selectedSource !== 'all' ? selectedSource : undefined,
        query: searchQuery || undefined,
        isRemote: selectedRemote === 'remote' ? true : selectedRemote === 'office' ? false : undefined,
        limit: 20,
        offset,
      });
      if (currentRequest === requestNumber.current) setData(res);
    } catch (err) {
      if (currentRequest === requestNumber.current) {
        setData(null);
        setError(err instanceof Error ? err.message : 'Не удалось загрузить вакансии');
      }
    } finally {
      if (currentRequest === requestNumber.current) setLoading(false);
    }
  }, [selectedSource, searchQuery, selectedRemote, offset]);

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

// eslint-disable-next-line max-lines-per-function -- one paged vacancy register with coordinated filters and detail dialog
export function AdminVacanciesView() {
  const [syncing, setSyncing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedRemote, setSelectedRemote] = useState<RemoteFilter>('all');
  const [offset, setOffset] = useState(0);
  const [sortBy, setSortBy] = useState<VacancySortKey>('published');
  const [descending, setDescending] = useState(true);
  const [selectedVacancy, setSelectedVacancy] = useState<AdminVacancySummary | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);
  const { data, loading, error, setError, fetchVacancies } = useVacancyLoader(selectedSource, debouncedQuery, selectedRemote, offset);
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
      <VacanciesHeader syncing={syncing} onSyncAll={handleSyncAll} sourcesNamed={sourceCountLabel(data?.statsBySource)} />
      {data && <VacancyStatsGrid data={data} />}
      <VacancyFilters
        searchQuery={searchQuery}
        onSearchChange={(value) => { setSearchQuery(value); setOffset(0); }}
        selectedSource={selectedSource}
        onSourceChange={(value) => { setSelectedSource(value); setOffset(0); }}
        selectedRemote={selectedRemote}
        onRemoteChange={(value) => { setSelectedRemote(value); setOffset(0); }}
        sources={data?.statsBySource}
      />
      <div className="admin-vacancy-sort" aria-label="Сортировка показанных вакансий">
        <span>На этой странице:</span>
        {([['title', 'Должность'], ['company', 'Компания'], ['source', 'Источник'], ['location', 'Место'], ['salary', 'Зарплата'], ['published', 'Дата']] as const).map(([value, label]) => (
          <button key={value} type="button" aria-pressed={sortBy === value} onClick={() => { setDescending(value === sortBy ? !descending : value === 'published'); setSortBy(value); }}>{label}{sortBy === value ? (descending ? ' ↓' : ' ↑') : ''}</button>
        ))}
      </div>
      {error && <div className="admin-alert admin-alert--error">{error}</div>}
      {loading ? <div className="admin-loading-state">Загрузка вакансий...</div> : data ? <VacanciesList items={sortVacancies(data.items, sortBy, descending)} onSelect={handleSelectVacancy} /> : null}
      {data && !loading ? (
        <nav className="admin-register-pager" aria-label="Страницы вакансий">
          <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 20))}>Назад</button>
          <span>Показано {data.items.length ? offset + 1 : 0}–{offset + data.items.length} из {data.total}</span>
          <button type="button" disabled={data.nextOffset === null} onClick={() => setOffset(data.nextOffset ?? offset)}>Далее</button>
        </nav>
      ) : null}
      {selectedVacancy && (
        <VacancyDetailModal vacancyId={selectedVacancy.id} onClose={() => handleSelectVacancy(null)} />
      )}
    </div>
  );
}
