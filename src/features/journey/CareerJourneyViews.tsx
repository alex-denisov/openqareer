import { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowSquareOut,
  Briefcase,
  Check,
  CircleNotch,
  Compass,
  FileText,
  Info,
  MapPin,
  SealCheck,
  Sparkle,
  WarningCircle,
} from '@phosphor-icons/react';
import {
  completeCandidateAnalysis,
  createCandidateAnalysis,
  updateEvidenceItem,
  type EvidenceItem,
} from '../evidence/evidenceEngine';
import {
  analyzeOpportunity,
  createOpportunityRecord,
} from '../opportunity/opportunityEngine';
import type {
  CandidateWorkspace,
  CareerGoal,
} from '../workspace/workspaceStorage';
import {
  buildCareerJourney,
  type CareerJourney,
  type CareerJourneyDestination,
} from './careerJourneyEngine';
import { fetchHhMarketSample } from './marketApi';

export interface JourneyViewProps {
  workspace: CandidateWorkspace;
  journey: CareerJourney;
  onNavigate: (view: CareerJourneyDestination | 'tariffs') => void;
  onOpenExpert: () => void;
  onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
}

export function TodayJourneyView({
  workspace,
  journey,
  onNavigate,
  onOpenExpert,
}: JourneyViewProps) {
  const activeTrack = journey.track.find((item) => item.status === 'active');
  const hasCareerEvidence =
    journey.profile.confirmedEvidence > 0 ||
    journey.profile.proposedEvidence > 0 ||
    journey.roles.length > 0;
  return (
    <div className="career-view career-today-view">
      <section className="career-next-decision" aria-labelledby="today-title">
        <div className="career-decision-copy">
          <p className="career-eyebrow">Следующее решение</p>
          <h1 id="today-title">{journey.nextAction.headline}</h1>
          <p className="career-lead">{journey.nextAction.reason}</p>
          <div className="career-primary-actions">
            <button
              className="career-primary-button"
              type="button"
              onClick={() => onNavigate(journey.nextAction.destination)}
            >
              {journey.nextAction.label}
              <ArrowRight size={18} weight="bold" />
            </button>
            <button
              className="career-quiet-button"
              type="button"
              onClick={onOpenExpert}
            >
              <Sparkle size={18} weight="fill" />
              Обсудить с экспертом
            </button>
          </div>
          <details className="career-action-explanation">
            <summary>Что изменится после этого</summary>
            <p>{journey.nextAction.expectedChange}</p>
          </details>
        </div>
        <div className="career-now-marker" aria-label="Текущий карьерный результат">
          <span>Сейчас</span>
          <strong>{activeTrack?.label ?? 'Карьерная картина'}</strong>
          <p>{activeTrack?.reason}</p>
        </div>
      </section>

      {hasCareerEvidence ? (
        <CareerPictureRibbon journey={journey} onNavigate={onNavigate} />
      ) : null}

      <CareerDiagnosticSummary
        journey={journey}
        hasCareerEvidence={hasCareerEvidence}
        careerGoal={workspace.careerGoal}
      />

      <section className="career-resume-note" aria-label="Состояние рабочего контекста">
        <FileText size={21} />
        <div>
          <strong>{journey.profile.sourceLabel}</strong>
          <span>
            {workspace.updatedAt === workspace.createdAt
              ? 'Карьерная картина только создана'
              : 'Последние изменения сохранены локально'}
          </span>
        </div>
        <button type="button" onClick={() => onNavigate('profile')}>
          Открыть профиль
          <ArrowRight size={16} />
        </button>
      </section>
    </div>
  );
}

function CareerDiagnosticSummary({
  journey,
  hasCareerEvidence,
  careerGoal,
}: {
  journey: CareerJourney;
  hasCareerEvidence: boolean;
  careerGoal?: CareerGoal;
}) {
  const priorityFindings = journey.diagnostic.findings
    .filter((finding) => finding.severity === 'high')
    .slice(0, 3);
  return (
    <section
      className="career-diagnostic-summary"
      aria-labelledby="career-diagnostic-title"
    >
      <div className="career-diagnostic-intro">
        <p className="career-eyebrow">Предварительная диагностика</p>
        {careerGoal ? (
          <p className="career-diagnostic-goal">
            Цель: {careerGoalLabel(careerGoal)}
          </p>
        ) : null}
        <h2 id="career-diagnostic-title">Что можно сказать уже сейчас</h2>
        <p>
          {hasCareerEvidence
            ? journey.diagnostic.summary
            : 'Не вывод: пока нет доказательств опыта. Ниже показаны границы анализа, которые нужно закрыть до выбора роли и рынка.'}
        </p>
      </div>
      <ol className="career-diagnostic-findings">
        {priorityFindings.map((finding) => (
          <li key={finding.id}>
            <span>
              {finding.certainty === 'fact' ? 'Проблема' : 'Неизвестно'}
            </span>
            <strong>{finding.title}</strong>
            <p>{finding.correction}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function careerGoalLabel(goal: CareerGoal): string {
  const labels: Record<CareerGoal, string> = {
    'find-job': 'найти работу',
    'choose-role': 'выбрать подходящую роль',
    positioning: 'проверить резюме и позиционирование',
    market: 'понять рынки и релокацию',
  };
  return labels[goal];
}

function CareerPictureRibbon({
  journey,
  onNavigate,
}: {
  journey: CareerJourney;
  onNavigate: JourneyViewProps['onNavigate'];
}) {
  const items = [
    {
      label: 'Подтверждено',
      value: String(journey.profile.confirmedEvidence),
      detail: 'фактов',
      destination: 'profile' as const,
    },
    {
      label: 'Нужно проверить',
      value: String(journey.profile.proposedEvidence),
      detail: 'утверждений',
      destination: 'profile' as const,
    },
    {
      label: 'Гипотезы ролей',
      value: String(journey.roles.length),
      detail: journey.roles.length ? 'для сравнения' : 'пока нет',
      destination: 'career' as const,
    },
    {
      label: 'Рынок',
      value: journey.markets[0]?.state === 'sample-ready' ? 'Есть выборка' : 'Не проверен',
      detail: journey.markets[0]?.label ?? 'не выбран',
      destination: 'career' as const,
    },
  ];
  return (
    <section className="career-picture-ribbon" aria-label="Карьерная картина">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => onNavigate(item.destination)}
        >
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          <small>{item.detail}</small>
        </button>
      ))}
    </section>
  );
}

export function ProfileJourneyView({
  workspace,
  journey,
  onOpenExpert,
  onUpdateWorkspace,
}: JourneyViewProps) {
  const [newEvidence, setNewEvidence] = useState('');
  const evidence = workspace.analysis?.evidenceItems ?? [];

  function changeEvidence(item: EvidenceItem, status: EvidenceItem['status']) {
    if (!workspace.analysis) return;
    const evidenceItems = workspace.analysis.evidenceItems.map((current) =>
      current.id === item.id ? updateEvidenceItem(current, { status }) : current,
    );
    const analysis = workspace.targetDirection.trim()
      ? completeCandidateAnalysis(
          workspace.targetDirection,
          { ...workspace.analysis, evidenceItems },
          new Date().toISOString(),
        )
      : { ...workspace.analysis, evidenceItems };
    onUpdateWorkspace({
      ...workspace,
      analysis,
      updatedAt: new Date().toISOString(),
    });
  }

  function addEvidence() {
    const clean = newEvidence.trim();
    if (clean.length < 30) return;
    const resumeText = [workspace.resumeText, clean].filter(Boolean).join('\n\n');
    const extracted = createCandidateAnalysis(resumeText);
    const priorByStatement = new Map(
      (workspace.analysis?.evidenceItems ?? []).map((item) => [
        item.statement,
        item,
      ]),
    );
    const evidenceItems = extracted.evidenceItems.map(
      (item) => priorByStatement.get(item.statement) ?? item,
    );
    const analysis = workspace.targetDirection.trim()
      ? completeCandidateAnalysis(
          workspace.targetDirection,
          { ...extracted, evidenceItems },
        )
      : { ...extracted, evidenceItems };
    onUpdateWorkspace({
      ...workspace,
      resumeText,
      resumeSource: 'text',
      analysis,
      updatedAt: new Date().toISOString(),
    });
    setNewEvidence('');
  }

  return (
    <div className="career-view career-profile-view">
      <ViewHeader
        eyebrow="Карьерная картина"
        title="Профиль"
        action="Проверить с экспертом"
        onAction={onOpenExpert}
      />
      <section className="career-profile-overview">
        <div className="career-profile-symbol" aria-hidden="true">
          {workspace.targetDirection.slice(0, 1).toUpperCase() || '?'}
        </div>
        <div>
          <strong>
            {workspace.targetDirection || 'Рабочее направление уточняется'}
          </strong>
          <span>{workspace.currentSituation}</span>
        </div>
        <ProfileState state={journey.profile.state} />
      </section>

      <CareerPictureRibbon journey={journey} onNavigate={() => undefined} />

      <div className="career-two-column-flow">
        <section className="career-evidence-section" aria-labelledby="evidence-title">
          <div className="career-section-heading">
            <div>
              <p className="career-eyebrow">Доказательства</p>
              <h2 id="evidence-title">Что известно об опыте</h2>
            </div>
            <span>{evidence.length} извлечено</span>
          </div>

          {evidence.length ? (
            <div className="career-evidence-list">
              {evidence.map((item) => (
                <article key={item.id} className="career-evidence-row">
                  <div>
                    <EvidenceKind kind={item.kind} />
                    <p>{item.statement}</p>
                    <small>Источник: {journey.profile.sourceLabel}</small>
                  </div>
                  <div className="career-evidence-actions">
                    <button
                      type="button"
                      className={item.status === 'confirmed' ? 'is-confirmed' : ''}
                      onClick={() => changeEvidence(item, 'confirmed')}
                    >
                      <Check size={15} weight="bold" />
                      Верно
                    </button>
                    <button
                      type="button"
                      className={item.status === 'rejected' ? 'is-rejected' : ''}
                      onClick={() => changeEvidence(item, 'rejected')}
                    >
                      Не использовать
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="career-empty-line">
              <Info size={21} />
              <p>
                Пока есть только ваш карьерный вопрос. Добавьте один пример
                работы, чтобы открыть гипотезы ролей.
              </p>
            </div>
          )}

          <div className="career-add-evidence">
            <label>
              <span>Добавить пример задачи или результата</span>
              <textarea
                value={newEvidence}
                onChange={(event) => setNewEvidence(event.target.value)}
                placeholder="Что вы делали, за какой масштаб отвечали и что изменилось?"
                rows={3}
              />
            </label>
            <button
              className="career-quiet-button"
              type="button"
              disabled={newEvidence.trim().length < 30}
              onClick={addEvidence}
            >
              Добавить в профиль
            </button>
          </div>
        </section>

        <aside className="career-open-questions" aria-labelledby="unknowns-title">
          <p className="career-eyebrow">Неизвестно</p>
          <h2 id="unknowns-title">Что сильнее всего изменит картину</h2>
          <ol>
            {journey.profile.importantUnknowns.length ? (
              journey.profile.importantUnknowns.map((question) => (
                <li key={question}>{question}</li>
              ))
            ) : (
              <li>Какие задачи вы хотите выполнять регулярно?</li>
            )}
          </ol>
          <button className="career-text-button" type="button" onClick={onOpenExpert}>
            Ответить в диалоге
            <ArrowRight size={16} />
          </button>
        </aside>
      </div>
    </div>
  );
}

export function CareerMapView({
  workspace,
  journey,
  onNavigate,
  onOpenExpert,
  onUpdateWorkspace,
}: JourneyViewProps) {
  const [target, setTarget] = useState(workspace.targetDirection);
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState<string>();

  function saveTarget() {
    const clean = target.trim();
    if (clean.length < 2) return;
    const analysisBase = workspace.analysis ?? createCandidateAnalysis(
      workspace.resumeText || workspace.currentSituation,
    );
    onUpdateWorkspace({
      ...workspace,
      targetDirection: clean,
      analysis: completeCandidateAnalysis(clean, analysisBase),
      updatedAt: new Date().toISOString(),
    });
  }

  async function collectMarketSample() {
    const query = workspace.targetDirection.trim();
    if (query.length < 2 || marketLoading) return;
    setMarketLoading(true);
    setMarketError(undefined);
    try {
      const marketSample = await fetchHhMarketSample(query);
      onUpdateWorkspace({
        ...workspace,
        marketSample,
        updatedAt: new Date().toISOString(),
      });
    } catch {
      setMarketError(
        'hh.ru не вернул выборку. Можно повторить позже или добавить вакансию вручную.',
      );
    } finally {
      setMarketLoading(false);
    }
  }

  return (
    <div className="career-view career-map-view">
      <ViewHeader
        eyebrow="Роли, рынок и путь"
        title="Карьера"
        action="Обсудить решение"
        onAction={onOpenExpert}
      />

      {!workspace.targetDirection.trim() ? (
        <section className="career-role-question">
          <div>
            <p className="career-eyebrow">Рабочая гипотеза</p>
            <h2>Как назвать направление для первой проверки?</h2>
            <p>
              Это не окончательный выбор. Название нужно, чтобы сопоставить ваш
              опыт с реальными задачами и вакансиями.
            </p>
          </div>
          <label>
            <span>Роль или группа задач</span>
            <input
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              placeholder="Например: операционное управление"
            />
          </label>
          <button
            className="career-primary-button"
            type="button"
            disabled={target.trim().length < 2}
            onClick={saveTarget}
          >
            Проверить гипотезу
            <ArrowRight size={17} />
          </button>
        </section>
      ) : null}

      {journey.roles.length ? (
        <section className="career-role-comparison" aria-labelledby="roles-title">
          <div className="career-section-heading">
            <div>
              <p className="career-eyebrow">Не рейтинг</p>
              <h2 id="roles-title">Гипотезы для проверки</h2>
            </div>
            <span>{journey.roles.length} направления</span>
          </div>
          <div className="career-role-table" role="list">
            {journey.roles.map((role, index) => (
              <article key={role.id} role="listitem" className="career-role-row">
                <span className="career-role-index">0{index + 1}</span>
                <div className="career-role-name">
                  <strong>{role.title}</strong>
                  <small>{role.basis}</small>
                </div>
                <div>
                  <span>Опора</span>
                  <strong>{role.evidenceCount} подтверждено</strong>
                </div>
                <div>
                  <span>Проверить</span>
                  <strong>{role.gaps[0] ?? 'Свежую рыночную выборку'}</strong>
                </div>
                <RoleState state={role.fitState} />
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="career-market-routes" aria-labelledby="market-title">
        <div className="career-section-heading">
          <div>
            <p className="career-eyebrow">География и формат</p>
            <h2 id="market-title">Маршруты рынка</h2>
          </div>
        </div>
        {journey.markets.map((market) => (
          <article key={market.id}>
            <MapPin size={21} />
            <div>
              <strong>{market.label}</strong>
              <p>{market.explanation}</p>
            </div>
            <span
              className={`career-market-state ${market.state === 'sample-ready' ? 'is-ready' : ''}`}
            >
              {market.state === 'sample-ready' ? 'Свежая выборка' : 'Нужна выборка'}
            </span>
          </article>
        ))}
        {workspace.market === 'ru' && !workspace.marketSample ? (
          <button
            className="career-primary-button career-market-collect"
            type="button"
            disabled={workspace.targetDirection.trim().length < 2 || marketLoading}
            onClick={collectMarketSample}
          >
            {marketLoading ? 'Собираем hh.ru…' : 'Собрать выборку hh.ru'}
            <ArrowRight size={17} />
          </button>
        ) : null}
        {workspace.market === 'international' ? (
          <button
            className="career-quiet-button career-market-collect"
            type="button"
            onClick={() => onNavigate('opportunities')}
          >
            Добавить международную вакансию
            <ArrowRight size={17} />
          </button>
        ) : null}
        {marketError ? (
          <p className="career-market-error" role="alert">{marketError}</p>
        ) : null}
      </section>

      {workspace.marketSample ? (
        <MarketSampleView
          sample={workspace.marketSample}
          fresh={journey.markets[0]?.state === 'sample-ready'}
          loading={marketLoading}
          onRefresh={collectMarketSample}
        />
      ) : null}

      <CareerTrack journey={journey} />
    </div>
  );
}

function MarketSampleView({
  sample,
  fresh,
  loading,
  onRefresh,
}: {
  sample: NonNullable<CandidateWorkspace['marketSample']>;
  fresh: boolean;
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <section className="career-market-sample" aria-labelledby="market-sample-title">
      <div className="career-section-heading">
        <div>
          <p className="career-eyebrow">
            hh.ru · наблюдение от {formatObservedAt(sample.fetchedAt)}
          </p>
          <h2 id="market-sample-title">
            {fresh ? 'Свежие вакансии по гипотезе' : 'Выборка устарела'}
          </h2>
        </div>
        <div className="career-market-sample-actions">
          <span>{sample.items.length} из {sample.found}</span>
          <button type="button" disabled={loading} onClick={onRefresh}>
            {loading ? 'Обновляем…' : 'Обновить'}
          </button>
        </div>
      </div>
      <div className="career-market-vacancies">
        {sample.items.slice(0, 6).map((item) => (
          <a
            key={item.id}
            href={item.sourceUrl}
            target="_blank"
            rel="noreferrer"
          >
            <span>
              <strong>{item.title}</strong>
              <small>{item.company} · {item.location}</small>
            </span>
            <span>
              <small>{formatSalary(item.salary)}</small>
              <ArrowSquareOut size={17} />
            </span>
          </a>
        ))}
      </div>
      <p className="career-market-caveat">
        Это наблюдение одного источника, а не весь рынок. Повторяющиеся требования
        нужно сравнить с профилем и другими площадками.
      </p>
    </section>
  );
}

function formatObservedAt(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatSalary(
  salary: NonNullable<CandidateWorkspace['marketSample']>['items'][number]['salary'],
): string {
  if (!salary) return 'Доход не указан';
  const formatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  const range = salary.from && salary.to
    ? `${formatter.format(salary.from)}–${formatter.format(salary.to)}`
    : salary.from
      ? `от ${formatter.format(salary.from)}`
      : salary.to
        ? `до ${formatter.format(salary.to)}`
        : 'Диапазон не указан';
  return `${range} ${salary.currency}${salary.gross ? ' до налогов' : ''}`;
}

function CareerTrack({ journey }: { journey: CareerJourney }) {
  return (
    <section className="career-track" aria-labelledby="track-title">
      <div className="career-section-heading">
        <div>
          <p className="career-eyebrow">Можно пересматривать</p>
          <h2 id="track-title">Карьерный трек</h2>
        </div>
      </div>
      <ol>
        {journey.track.map((item) => (
          <li key={item.id} className={`is-${item.status}`}>
            <span className="career-track-marker">
              {item.status === 'complete' ? (
                <Check size={16} weight="bold" />
              ) : item.status === 'active' ? (
                <CircleNotch size={17} weight="bold" />
              ) : null}
            </span>
            <div>
              <strong>{item.label}</strong>
              <p>{item.reason}</p>
            </div>
            <small>
              {item.status === 'complete'
                ? 'Собрано'
                : item.status === 'active'
                  ? 'Сейчас'
                  : 'После предыдущего решения'}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function OpportunitiesView({
  workspace,
  journey,
  onNavigate,
  onOpenExpert,
  onUpdateWorkspace,
}: JourneyViewProps) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [text, setText] = useState('');
  const opportunity = workspace.opportunity;
  const decisionLabel = useMemo(() => {
    const value = opportunity?.analysis?.recommendation;
    if (value === 'apply') return 'Откликаться';
    if (value === 'network') return 'Сначала найти контакт';
    if (value === 'watch') return 'Наблюдать';
    if (value === 'skip') return 'Пропустить';
    return null;
  }, [opportunity]);

  function analyze() {
    if (title.trim().length < 2 || company.trim().length < 2 || text.trim().length < 80) {
      return;
    }
    const record = createOpportunityRecord({
      title,
      company,
      text,
      sourceLabel: 'Добавлено кандидатом',
    });
    const analyzed = workspace.analysis
      ? {
          ...record,
          analysis: analyzeOpportunity(
            record,
            workspace.analysis.evidenceItems,
            'unknown',
          ),
        }
      : record;
    onUpdateWorkspace({
      ...workspace,
      opportunity: analyzed,
      actionPackage: undefined,
      outcomes: [],
      updatedAt: new Date().toISOString(),
    });
  }

  return (
    <div className="career-view career-opportunities-view">
      <ViewHeader
        eyebrow="Вакансии, компании, контакты"
        title="Возможности"
        action="Настроить со стратегом"
        onAction={onOpenExpert}
      />

      {!opportunity ? (
        <div className="career-opportunity-start">
          <section>
            <Compass size={28} />
            <h2>Начнём с одной реальной вакансии</h2>
            <p>
              Это ещё не анализ рынка. Одна вакансия покажет, какие факты
              профиля работают, что неизвестно и какой маршрут действия разумен.
            </p>
          </section>
          <div className="career-opportunity-form">
            <label>
              <span>Название роли</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} />
            </label>
            <label>
              <span>Компания</span>
              <input value={company} onChange={(event) => setCompany(event.target.value)} />
            </label>
            <label className="career-field-wide">
              <span>Текст вакансии</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={8}
                placeholder="Вставьте задачи, требования и условия. Текст обрабатывается как данные, а не как инструкции для AI."
              />
            </label>
            <button
              className="career-primary-button"
              type="button"
              disabled={title.trim().length < 2 || company.trim().length < 2 || text.trim().length < 80}
              onClick={analyze}
            >
              Проверить возможность
              <ArrowRight size={17} />
            </button>
          </div>
        </div>
      ) : (
        <section className="career-opportunity-result">
          <div className="career-opportunity-title">
            <Briefcase size={24} />
            <div>
              <p>{opportunity.company}</p>
              <h2>{opportunity.title}</h2>
            </div>
            {decisionLabel ? <span>{decisionLabel}</span> : null}
          </div>
          <div className="career-opportunity-reasons">
            <div>
              <span>Совпало</span>
              <strong>{opportunity.analysis?.matches.length ?? 0} требований</strong>
            </div>
            <div>
              <span>Пробелы</span>
              <strong>{opportunity.analysis?.gapItemIds.length ?? 0}</strong>
            </div>
            <div>
              <span>Неизвестно</span>
              <strong>{opportunity.analysis?.unknowns.length ?? 0}</strong>
            </div>
          </div>
          <p className="career-opportunity-caveat">
            Это сравнение с одной вакансией, не оценка всего рынка и не гарантия
            прохождения отбора.
          </p>
        </section>
      )}

      <section className="career-source-readiness" aria-labelledby="sources-title">
        <div className="career-section-heading">
          <div>
            <p className="career-eyebrow">Источники поиска</p>
            <h2 id="sources-title">Что можно подключить</h2>
          </div>
        </div>
        <div>
          <SourceCapability
            title="PDF, текст, экспорт LinkedIn и hh.ru"
            state="available"
            detail="Работает локально без паролей и cookies."
          />
          <SourceCapability
            title="hh.ru: свежая выборка вакансий"
            state="available"
            detail="Публичный источник с датой наблюдения и ссылками на оригиналы."
          />
          <SourceCapability
            title="LinkedIn и hh.ru, тестовые аккаунты"
            state="prepared"
            detail="Адаптеры проверяются только после завершения интерфейса."
          />
          <SourceCapability
            title="Другие работные сайты и career pages"
            state="prepared"
            detail="Потребуются источники, даты и проверка качества дублей."
          />
        </div>
      </section>

      <section
        className={`career-paid-moment ${
          journey.commercialBoundary.state === 'free-route-incomplete'
            ? 'is-free-route'
            : ''
        }`}
      >
        <div>
          {journey.commercialBoundary.state === 'assisted-setup-eligible' ? (
            <Sparkle size={21} weight="fill" />
          ) : (
            <Compass size={21} />
          )}
          <span>
            <strong>{journey.commercialBoundary.headline}</strong>
            <small>{journey.commercialBoundary.reason}</small>
          </span>
        </div>
        <button
          type="button"
          onClick={() =>
            onNavigate(
              journey.commercialBoundary.state === 'assisted-setup-eligible'
                ? 'tariffs'
                : 'career',
            )
          }
        >
          {journey.commercialBoundary.state === 'assisted-setup-eligible'
            ? 'Посмотреть объём работы'
            : 'Завершить роль и рынок'}
          <ArrowRight size={16} />
        </button>
      </section>
    </div>
  );
}

function SourceCapability({
  title,
  state,
  detail,
}: {
  title: string;
  state: 'available' | 'prepared';
  detail: string;
}) {
  return (
    <article>
      {state === 'available' ? (
        <SealCheck size={21} weight="fill" />
      ) : (
        <WarningCircle size={21} />
      )}
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <small>{state === 'available' ? 'Доступно' : 'Готово к тестированию'}</small>
    </article>
  );
}

function ViewHeader({
  eyebrow,
  title,
  action,
  onAction,
}: {
  eyebrow: string;
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <header className="career-view-heading">
      <div>
        <p className="career-eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <button className="career-quiet-button" type="button" onClick={onAction}>
        <Sparkle size={17} weight="fill" />
        {action}
      </button>
    </header>
  );
}

function ProfileState({ state }: { state: CareerJourney['profile']['state'] }) {
  return (
    <span className={`career-profile-state is-${state}`}>
      {state === 'grounded'
        ? 'Есть опорные факты'
        : state === 'needs-review'
          ? 'Нужно подтвердить'
          : 'Формируется'}
    </span>
  );
}

function EvidenceKind({ kind }: { kind: EvidenceItem['kind'] }) {
  const labels: Record<EvidenceItem['kind'], string> = {
    result: 'Результат',
    responsibility: 'Ответственность',
    scope: 'Масштаб',
    expertise: 'Экспертиза',
  };
  return <span className={`career-evidence-kind is-${kind}`}>{labels[kind]}</span>;
}

function RoleState({ state }: { state: CareerJourney['roles'][number]['fitState'] }) {
  return (
    <span className={`career-role-state is-${state}`}>
      {state === 'plausible'
        ? 'Рабочая гипотеза'
        : state === 'adjacent'
          ? 'Смежная'
          : 'Нужны факты'}
    </span>
  );
}

export function rebuildJourney(workspace: CandidateWorkspace): CareerJourney {
  return buildCareerJourney(workspace);
}
