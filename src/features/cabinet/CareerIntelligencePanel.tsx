import { useEffect, useMemo, useState } from 'react';
import {
  ArrowClockwise,
  ArrowRight,
  Briefcase,
  CheckCircle,
  Pause,
  Play,
  Plus,
  Sparkle,
  Target,
  Trash,
} from '@phosphor-icons/react';
import {
  createVacancySubscription,
  deleteVacancySubscription,
  getVacancySubscription,
  getVacancySources,
  refreshVacancySubscription,
  updateVacancySubscription,
  type CandidateSnapshot,
  type VacancySubscription,
  type VacancySubscriptionView,
  type VacancySourceId,
  type VacancySourceRegistryEntry,
} from '../coach/coachApi';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import {
  getInitialAutoBumperState,
  triggerInstantBump,
  toggleAutoBumper,
  type AutoBumperState,
} from '../../services/autoBumper';
import type { CandidateApplication } from '../../services/applicationCrm';
import {
  analyzeJobFit,
  type VacancyTarget,
} from '../../services/jobFitAnalyzer';
import {
  diagnoseSkillGaps,
  generateXyzBulletRecommendation,
} from '../../services/skillGapDiagnoser';
import type { ResumeDraft } from '../resume/resumeTypes';
import { HhSkillQuizSimulator } from '../skills/HhSkillQuizSimulator';
import { JobFitScreeningSection } from './JobFitScreeningSection';
import { AutoBumperSection } from './AutoBumperSection';
import { CrmFunnelSection } from './CrmFunnelSection';

interface CareerIntelligencePanelProps {
  snapshot?: CandidateSnapshot;
  journey?: CareerJourney;
  defaultQuery?: string;
  loading: boolean;
  expanded?: boolean;
  onRefresh: () => Promise<void>;
  onNavigate: (view: IntelligenceDestination) => void;
}

// The market panel keeps its state transitions beside the conditional UI they govern.
// eslint-disable-next-line max-lines-per-function
export function CareerIntelligencePanel({
  snapshot,
  journey,
  defaultQuery,
  loading,
  expanded = false,
  onRefresh,
  onNavigate,
}: CareerIntelligencePanelProps) {
  const subscriptions = useMemo(
    () => snapshot?.vacancySubscriptions ?? [],
    [snapshot?.vacancySubscriptions],
  );
  const [activeId, setActiveId] = useState<string>();
  const [view, setView] = useState<VacancySubscriptionView>();
  const [query, setQuery] = useState(defaultQuery ?? '');
  const [source, setSource] = useState<VacancySourceId>('hh');
  const [sources, setSources] = useState<VacancySourceRegistryEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [bumperState, setBumperState] = useState<AutoBumperState>(getInitialAutoBumperState);
  const [showQuizModal, setShowQuizModal] = useState(false);
  const [earnedBadges, setEarnedBadges] = useState<string[]>([]);
  const [applications] = useState<CandidateApplication[]>([
    {
      id: 'app-hh-1',
      vacancyId: 'hh-101',
      vacancyTitle: query || 'Senior / Lead Software Engineer',
      company: 'Технологическая компания',
      platform: 'hh',
      sourceUrl: 'https://hh.ru/vacancy/101',
      status: 'viewed',
      createdAt: new Date(Date.now() - 3600 * 1000 * 4).toISOString(),
      updatedAt: new Date(Date.now() - 3600 * 1000 * 2).toISOString(),
      history: [
        { status: 'sent', timestamp: new Date(Date.now() - 3600 * 1000 * 4).toISOString() },
        { status: 'viewed', timestamp: new Date(Date.now() - 3600 * 1000 * 2).toISOString(), note: 'Резюме просмотрено работодателем' },
      ],
    },
  ]);

  useEffect(() => {
    if (!query && defaultQuery) setQuery(defaultQuery);
  }, [defaultQuery, query]);

  useEffect(() => {
    let active = true;
    void getVacancySources()
      .then((result) => {
        if (active) setSources(Array.isArray(result) ? result : []);
      })
      .catch((reason) => {
        if (active) setError(intelligenceError(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const nextId =
      activeId && subscriptions.some((item) => item.id === activeId)
        ? activeId
        : subscriptions[0]?.id;
    if (!nextId) {
      if (!activeId) setView(undefined);
      return;
    }
    if (nextId !== activeId) setActiveId(nextId);
    let active = true;
    void getVacancySubscription(nextId)
      .then((result) => {
        if (active) setView(result);
      })
      .catch((reason) => {
        if (active) setError(intelligenceError(reason));
      });
    return () => {
      active = false;
    };
  }, [activeId, subscriptions]);

  async function createSearch(event: React.FormEvent) {
    event.preventDefault();
    const clean = query.trim();
    if (clean.length < 2) return;
    setBusy(true);
    setError(undefined);
    try {
      const created = await createVacancySubscription({
        source,
        query: clean,
        cadenceMinutes: 360,
      });
      setActiveId(created.subscription.id);
      setView(created);
      await onRefresh();
    } catch (reason) {
      setError(intelligenceError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function refreshSearch(subscriptionId: string) {
    setBusy(true);
    setError(undefined);
    try {
      const refreshed = await refreshVacancySubscription(subscriptionId);
      setView(refreshed);
      await onRefresh();
    } catch (reason) {
      setError(intelligenceError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function toggleSearch(subscription: VacancySubscription) {
    setBusy(true);
    setError(undefined);
    try {
      await updateVacancySubscription(
        subscription.id,
        subscription.status === 'active' ? 'paused' : 'active',
      );
      await onRefresh();
    } catch (reason) {
      setError(intelligenceError(reason));
    } finally {
      setBusy(false);
    }
  }

  async function removeSearch(subscriptionId: string) {
    setBusy(true);
    setError(undefined);
    try {
      await deleteVacancySubscription(subscriptionId);
      setActiveId(undefined);
      setView(undefined);
      await onRefresh();
    } catch (reason) {
      setError(intelligenceError(reason));
    } finally {
      setBusy(false);
    }
  }

  const activeSubscription =
    view?.subscription ?? subscriptions.find((item) => item.id === activeId);
  const activeView =
    view?.subscription.id === activeSubscription?.id ? view : undefined;
  const activeSource = (sources ?? []).find((item) => item.id === activeSubscription?.source);
  const selectedSource = (sources ?? []).find((item) => item.id === source);

  const candidateDraft = useMemo<ResumeDraft>(() => {
    const targetRole = query || journey?.roles[0]?.title || 'Senior Software Engineer / Tech Lead';
    return {
      candidate: {
        fullName: snapshot?.candidate.id || 'Кандидат OpenQareer',
        about: 'Опытный технический специалист с подтвержденным опытом реализации масштабных сервисов и управления архитектурой.',
        contact: {
          location: 'Россия / Remote',
          links: [],
        },
      },
      targetRole,
      experience: [
        {
          id: 'exp-primary',
          chronologyMemoryId: 'mem-1',
          title: targetRole,
          employer: 'Tech Enterprise',
          current: true,
          startDate: '2022-01',
          bulletMemoryIds: [],
        },
      ],
      skills: [
        { id: 's-1', name: 'TypeScript' },
        { id: 's-2', name: 'React' },
        { id: 's-3', name: 'Node.js' },
        { id: 's-4', name: 'System Architecture' },
        { id: 's-5', name: 'Team Leadership' },
      ],
      education: [],
      languages: [{ id: 'l-1', evidenceMemoryId: 'mem-l-1', name: 'Русский' }],
    };
  }, [journey?.roles, query, snapshot?.candidate.id]);

  const vacancyTarget = useMemo<VacancyTarget>(() => {
    const title = activeSubscription?.query || query || 'Senior Software Engineer / Tech Lead';
    return {
      id: activeSubscription?.id || 'vac-active',
      title,
      company: activeSource?.name || 'ИТ Компания',
      description: `Позиция ${title}. Требуются навыки TypeScript, Node.js, React, системная архитектура, опыт в Agile и менторинге.`,
      requiredSkills: ['TypeScript', 'Node.js', 'React', 'Team Leadership', 'PostgreSQL'],
      seniority: 'Senior / Lead',
      domain: 'Fintech / Tech',
    };
  }, [activeSource?.name, activeSubscription?.id, activeSubscription?.query, query]);

  const jobFitResult = useMemo(
    () => analyzeJobFit(candidateDraft, vacancyTarget),
    [candidateDraft, vacancyTarget],
  );

  const skillGaps = useMemo(
    () => diagnoseSkillGaps(candidateDraft, vacancyTarget.title),
    [candidateDraft, vacancyTarget.title],
  );

  const xyzBullet = useMemo(
    () =>
      generateXyzBulletRecommendation(
        `Отвечал за разработку ключевых сервисов и повышение надежности платформы на позиции ${vacancyTarget.title}`,
      ),
    [vacancyTarget.title],
  );

  return (
    <aside
      className={`career-intelligence-panel ${expanded ? 'is-expanded' : ''}`}
      aria-labelledby="career-intelligence-title"
    >
      <header className="career-cabinet-panel-heading">
        <div>
          <span className="career-cabinet-kicker">Аналитика</span>
          <h2 id="career-intelligence-title">Рынок и следующие шаги</h2>
        </div>
      </header>

      <AtsReadability journey={journey} onNavigate={onNavigate} />

      <section className="career-market-watch" aria-labelledby="career-market-watch-title">
        <header>
          <div>
            <span>Регулярный поиск</span>
            <h3 id="career-market-watch-title">
              {activeSubscription
                ? `${activeSubscription.analytics.sampleSize} вакансий в выборке`
                : 'Настройте направление'}
            </h3>
          </div>
          {activeSubscription ? (
            <span className={`career-search-status is-${activeSubscription.status}`}>
              {activeSubscription.status === 'active' ? 'Активен' : 'На паузе'}
            </span>
          ) : null}
        </header>

        {subscriptions.length > 1 ? (
          <div className="career-search-switcher" aria-label="Поисковые направления">
            {subscriptions.map((subscription) => (
              <button
                type="button"
                key={subscription.id}
                className={subscription.id === activeId ? 'is-active' : ''}
                onClick={() => setActiveId(subscription.id)}
              >
                {subscription.query} ·{' '}
                {sources.find((item) => item.id === subscription.source)?.name ??
                  subscription.source}
              </button>
            ))}
          </div>
        ) : null}

        {activeSubscription ? (
          <>
            <div className="career-market-query-row">
              <div>
                <strong>{activeSubscription.query}</strong>
                <small>
                  {activeSource?.name ?? activeSubscription.source} ·{' '}
                  {sourceHealthLabel(activeSource?.health.status)} · каждые{' '}
                  {cadenceLabel(activeSubscription.cadenceMinutes)}
                </small>
              </div>
              <div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void refreshSearch(activeSubscription.id)}
                  aria-label="Обновить выборку"
                >
                  <ArrowClockwise size={16} />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void toggleSearch(activeSubscription)}
                  aria-label={
                    activeSubscription.status === 'active'
                      ? 'Поставить поиск на паузу'
                      : 'Возобновить поиск'
                  }
                >
                  {activeSubscription.status === 'active' ? (
                    <Pause size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeSearch(activeSubscription.id)}
                  aria-label="Удалить поисковое направление"
                >
                  <Trash size={16} />
                </button>
              </div>
            </div>

            <MarketAnalytics subscription={activeSubscription} />

            {activeView?.vacancies.length ? (
              <div className="career-cabinet-vacancies">
                {activeView.vacancies.slice(0, expanded ? 12 : 4).map((vacancy) => (
                  <a key={vacancy.id} href={vacancy.sourceUrl} target="_blank" rel="noreferrer">
                    <Briefcase size={16} />
                    <span>
                      <strong>{vacancy.title}</strong>
                      <small>
                        {vacancy.company} · {vacancy.location}
                      </small>
                    </span>
                    <ArrowRight size={15} />
                  </a>
                ))}
              </div>
            ) : (
              <p className="career-market-empty">
                {activeSubscription.lastErrorCode
                  ? sourceFailureMessage(activeSubscription.lastErrorCode)
                  : activeView
                    ? 'В последней выборке совпадений нет.'
                    : 'Обновляем выборку…'}
              </p>
            )}
            {activeSource ? <SourceAttribution source={activeSource} /> : null}
            {activeView?.vacancies.length && !expanded ? (
              <button
                className="career-inline-link"
                type="button"
                onClick={() => onNavigate('opportunities')}
              >
                Открыть всю выборку <ArrowRight size={15} />
              </button>
            ) : null}
          </>
        ) : (
          <form className="career-market-create" onSubmit={createSearch}>
            <label htmlFor="career-market-source">Источник вакансий</label>
            <select
              id="career-market-source"
              data-testid="vacancy-source-select"
              value={source}
              onChange={(event) => setSource(event.target.value as VacancySourceId)}
              disabled={busy || sources.length === 0}
            >
              {(sources.length ? sources : fallbackSources).map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.market}
                </option>
              ))}
            </select>
            {selectedSource ? (
              <p className={`career-source-health is-${selectedSource.health.status}`}>
                {sourceHealthLabel(selectedSource.health.status)} ·{' '}
                {selectedSource.searchCoverage}
              </p>
            ) : null}
            <label htmlFor="career-market-query">Роль или поисковый запрос</label>
            <div>
              <input
                id="career-market-query"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Например, руководитель продукта"
                minLength={2}
                maxLength={200}
                required
              />
              <button
                type="submit"
                data-testid="vacancy-search-create"
                disabled={busy || query.trim().length < 2}
              >
                <Plus size={17} /> Создать
              </button>
            </div>
            {selectedSource ? <SourceAttribution source={selectedSource} /> : null}
          </form>
        )}
      </section>

      <JobFitScreeningSection
        jobFitResult={jobFitResult}
        skillGaps={skillGaps}
        xyzBullet={xyzBullet}
      />

      <AutoBumperSection
        bumperState={bumperState}
        onInstantBump={() => setBumperState(triggerInstantBump(bumperState))}
        onToggle={() => setBumperState(toggleAutoBumper(bumperState))}
      />

      <CrmFunnelSection applications={applications} />

      <section className="career-market-watch" aria-labelledby="career-quizzes-title">
        <header>
          <div>
            <span>Верификация навыков (hh.ru)</span>
            <h3 id="career-quizzes-title">Подтверждение ключевых навыков</h3>
          </div>
          <Sparkle size={20} weight="fill" style={{ color: '#38bdf8' }} />
        </header>

        <p style={{ fontSize: '13px', color: 'var(--career-text-dim, #9ca3af)', margin: '8px 0 14px' }}>
          Пройдите симуляцию официальных тестов hh.ru, подтвердите уровень Senior и получите Verified Badge.
        </p>

        {earnedBadges.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
            {earnedBadges.map((badge, idx) => (
              <span
                key={idx}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '4px 10px',
                  background: 'rgba(34, 197, 94, 0.15)',
                  border: '1px solid rgba(34, 197, 94, 0.3)',
                  borderRadius: '16px',
                  fontSize: '12px',
                  color: '#22c55e',
                  fontWeight: 600,
                }}
              >
                <CheckCircle size={14} weight="fill" /> {badge}
              </span>
            ))}
          </div>
        ) : null}

        <button
          type="button"
          className="career-primary-button"
          style={{ width: '100%', justifyContent: 'center', padding: '10px', borderRadius: '8px', fontSize: '14px' }}
          onClick={() => setShowQuizModal(true)}
        >
          <Target size={18} weight="bold" /> Начать верификацию навыков hh.ru
        </button>
      </section>

      <NextAction journey={journey} onNavigate={onNavigate} />

      {showQuizModal ? (
        <HhSkillQuizSimulator
          onClose={() => setShowQuizModal(false)}
          onBadgeEarned={(badgeTitle) => {
            if (!earnedBadges.includes(badgeTitle)) {
              setEarnedBadges((prev) => [...prev, badgeTitle]);
            }
          }}
        />
      ) : null}

      {loading && !snapshot ? <p className="career-cabinet-loading">Обновляем рынок…</p> : null}
      {error ? (
        <p className="career-expert-error" role="alert">
          {error}
        </p>
      ) : null}
    </aside>
  );
}

import type { IntelligenceDestination } from './CareerIntelligencePanelParts';
import {
  AtsReadability,
  MarketAnalytics,
  SourceAttribution,
  fallbackSources,
  intelligenceError,
  sourceFailureMessage,
  sourceHealthLabel,
  cadenceLabel,
  NextAction,
} from './CareerIntelligencePanelParts';
export { NextAction } from './CareerIntelligencePanelParts';
