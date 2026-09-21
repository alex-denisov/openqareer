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
  type AdminCountedShare,
  type AdminSourceHealth,
  type AdminSourceSchedule,
  type AdminVacancySource,
  type VacancySourceTestItem,
  type VacancySourceTestResult,
} from './adminApi';
import type { VacancySourcesState } from './vacancySourcesState';
import { sourceScheduleLabel } from './sourceScheduleLabel';

/**
 * B200 — живость и доверие площадки показываются как две разные шкалы.
 * «Отвечает 200» и «жива» — не одно и то же: площадка может исправно отдавать
 * прошлогодний архив. Каждое число печатается со своим знаменателем (B192).
 */
const LIVENESS_LABELS: Record<AdminSourceHealth['liveness']['verdict'], string> = {
  never_read: 'Не опрошена',
  unreachable: 'Недоступна',
  alive: 'Жива',
  fading: 'Затухает',
  dead: 'Мертва',
};

const LIVENESS_TONES: Record<AdminSourceHealth['liveness']['verdict'], string> = {
  never_read: 'is-muted',
  unreachable: 'is-error',
  alive: 'is-success',
  fading: 'is-warning',
  dead: 'is-error',
};

const TRUST_LABELS: Record<AdminSourceHealth['trust']['verdict'], string> = {
  unknown: 'Доверие неизвестно',
  trusted: 'Доверенная',
  mixed: 'Доверие частичное',
  low: 'Не доверять',
};

const TRUST_TONES: Record<AdminSourceHealth['trust']['verdict'], string> = {
  unknown: 'is-muted',
  trusted: 'is-success',
  mixed: 'is-warning',
  low: 'is-error',
};

function countedShare(share: AdminCountedShare): string {
  return `${share.counted} из ${share.of}`;
}

/**
 * Обход ссылок объявлений (B200 срез 2). Лента может отдавать свежие даты у
 * вакансий, которых на сайте уже нет, — единственное доказательство обратного
 * лежит здесь. Замера, которого не было, экран числом не называет.
 */
function SourceLinkCheckFact({ liveness }: { liveness: AdminSourceHealth['liveness'] }) {
  const linkCheck = liveness.linkCheck;
  if (!linkCheck || linkCheck.checked === 0 || !linkCheck.checkedAt) {
    return <li>Ссылки объявлений ещё не проверяли</li>;
  }
  return (
    <li>
      Ссылок открылось: {linkCheck.open} из {linkCheck.checked} (выборка из{' '}
      {linkCheck.sampledFrom}), проверено{' '}
      {new Date(linkCheck.checkedAt).toLocaleDateString('ru-RU')}
      {linkCheck.unknown > 0 ? `; без ответа ${linkCheck.unknown}` : ''}
    </li>
  );
}

/** Измеренные факты под приговорами: каждое число со своим знаменателем. */
function SourceHealthFacts({ health }: { health: AdminSourceHealth }) {
  const { liveness, trust } = health;
  return (
    /*
      Перепись описывает последний непустой улов, а не сегодняшний ответ:
      площадка, замолчавшая вчера, показывает вчерашние числа и отдельно —
      серию пустых уловов. Подпись обязана это называть.
    */
    <ul className="admin-source-health-facts">
      <li>
        В последнем непустом улове свежее 30 дней:{' '}
        {countedShare(liveness.fresherThan30Days)}
      </li>
      <li>В нём же свежее 180 дней: {countedShare(liveness.fresherThan180Days)}</li>
      <li>Карточек с работодателем: {countedShare(trust.completeness.withEmployer)}</li>
      <li>За 30 дней успешных опросов: {countedShare(trust.consistency.successful)}</li>
      <li>
        Право читать площадку:{' '}
        {trust.lawfulness.permitted
          ? 'установлено'
          : `не установлено (${trust.lawfulness.addressStatus})`}
      </li>
      <SourceLinkCheckFact liveness={liveness} />
      {trust.authenticity.measured ? (
        <>
          <li>Подлинных объявлений: {countedShare(trust.authenticity.originalShare)}</li>
          <li>Перепечаток: {countedShare(trust.authenticity.reprintShare)}</li>
        </>
      ) : (
        <li>Подлинность не измерена — ждёт дедупликатора B205</li>
      )}
    </ul>
  );
}

/**
 * B204 сделал расписание, но администратор его не видел: маршрут отдавал
 * только живость и доверие, и «почему площадку не опрашивают» оставалось
 * вопросом без ответа (названо в B204, показано 2026-09-07).
 */
function SourceSchedule({ schedule }: { schedule?: AdminSourceSchedule }) {
  if (!schedule) return null;
  return (
    <p className="admin-source-schedule">
      <span className={`admin-badge ${schedule.due ? 'is-ok' : 'is-muted'}`}>Расписание</span>
      <span>{sourceScheduleLabel(schedule)}</span>
      <span className="admin-note">{schedule.reason}</span>
    </p>
  );
}

function ManualSyncStatus({
  status,
}: {
  status?: AdminVacancySource['manualSync'];
}) {
  if (!status || status.status === 'ready') return null;
  const running = status.status === 'running';
  return (
    <p className="admin-source-schedule" role="status" aria-live="polite">
      <span className={`admin-badge ${running ? 'is-warning' : 'is-muted'}`}>
        {running ? 'Выполняется' : 'В очереди'}
      </span>
      <span>
        {running
          ? 'Обслуживатель уже опрашивает площадку.'
          : 'Обслуживатель заберёт запрос в ближайшем такте.'}
      </span>
    </p>
  );
}

function SourceHealthPanel({ health }: { health?: AdminSourceHealth }) {
  if (!health) {
    return (
      <div className="admin-source-health">
        <span className="admin-badge is-muted">Не опрошена</span>
        <p className="admin-note">Этот сервер площадку ещё ни разу не опрашивал.</p>
      </div>
    );
  }

  const { liveness, trust } = health;
  const justified = trust.verdict === 'low' || trust.verdict === 'mixed';
  return (
    <div className="admin-source-health">
      <div className="admin-source-health-badges">
        <span className={`admin-badge ${LIVENESS_TONES[liveness.verdict]}`}>
          {LIVENESS_LABELS[liveness.verdict]}
        </span>
        <span className={`admin-badge ${TRUST_TONES[trust.verdict]}`}>
          {TRUST_LABELS[trust.verdict]}
        </span>
      </div>

      <p className="admin-note">{liveness.reason}</p>

      <SourceHealthFacts health={health} />

      {/*
        Причины объясняют приговор доверия. У «неизвестно» приговора нет — там
        они лишь повторяли бы факты выше, а повтор читается как второй довод.
      */}
      {justified && trust.reasons.length > 0 ? (
        <ul className="admin-source-health-reasons">
          {trust.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

interface AdminVacancySourcesViewProps {
  state: VacancySourcesState;
  onRefresh: () => void;
  onSync: (sourceId: string) => Promise<void>;
}

/**
 * Три ответа экрана — три разных вида (B207). Отказ маршрута выглядел ровно
 * как честный пустой список, и администратор не мог их различить.
 */
function SourcesBody({
  state,
  onRefresh,
  onSync,
  onOpenTest,
}: {
  state: VacancySourcesState;
  onRefresh: () => void;
  onSync: (sourceId: string) => Promise<void>;
  onOpenTest: (source: AdminVacancySource) => void;
}) {
  if (state.status === 'failed') {
    return (
      <div className="admin-error" role="alert">
        <p>{state.message}</p>
        <button className="admin-quiet-button" type="button" onClick={onRefresh}>
          Повторить
        </button>
      </div>
    );
  }

  // Пока загрузка не кончилась, пустота — это ещё не ответ.
  if (state.status === 'loading') return null;

  if (state.sources.length === 0) {
    return <p className="admin-note is-empty-note">Ни одной площадки не зарегистрировано.</p>;
  }

  return (
    <div className="admin-sources-grid">
      {state.sources.map((source) => (
        <SourceCard key={source.id} source={source} onSync={onSync} onOpenTest={onOpenTest} />
      ))}
    </div>
  );
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

      <SourceSchedule schedule={source.schedule} />
      <ManualSyncStatus status={source.manualSync} />
      <SourceHealthPanel health={source.health} />

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
  state,
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
          disabled={state.status === 'loading'}
          onClick={onRefresh}
        >
          <ArrowsClockwise
            size={16}
            className={state.status === 'loading' ? 'is-spinning' : ''}
          />
          Обновить статус
        </button>
      </div>

      <SourcesBody
        state={state}
        onRefresh={onRefresh}
        onSync={onSync}
        onOpenTest={(src) => setTestingSource(src)}
      />

      {testingSource ? (
        <VacancySourceTestModal
          source={testingSource}
          onClose={() => setTestingSource(null)}
        />
      ) : null}
    </div>
  );
}
