import { ArrowRight, ChatCircleDots } from '@phosphor-icons/react';
import type { AccountSnapshot, AuthUser, CandidateSnapshot, CoachResult } from '../coach/coachApi';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import { candidateRegionLabels, type CandidateRegion } from '../workspace/candidateRegions';
import { CareerProfileSurface } from './CareerProfileSurface';
import { assessProfile, type ProfileMeasure, type ProfileScore } from './profileAssessment';
import { buildProfileView } from './profileView';
import { RolesMarketPanel, type RoleChoiceActions } from './RolesMarketPanel';
import { CareerStrategyPanel } from './CareerStrategyPanel';
import { WorkPreferencesPanel } from './WorkPreferencesPanel';
import type { WorkPreferencesState } from './useWorkPreferences';
import type { CareerStrategyRead } from './useCareerStrategy';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { ProposedRole } from '../../../shared/roleProposals';
import type { VacancyApplication } from '../../../shared/vacancyApplication';
import type { CareerCabinetView } from './cabinetViews';
import { NextAction, AtsReadability, FollowUpActionCard } from './CareerIntelligencePanelParts';

/**
 * «Главная» — кандидат и его факты слева, оценка, позиционирование и вход к
 * консультанту справа («Пульт», решение владельца 2026-08-31).
 *
 * Слева — сам кандидат, собранный из разобранного резюме: карточка личности,
 * вкладки и места работы с датами и пунктами. Справа — оценка профиля,
 * позиционирование и вход к консультанту.
 *
 * Ни очереди «Подтвердите опорные факты», ни карточки следующего шага здесь
 * нет: макет от них отказался, а разобранное резюме — это то, что кандидат сам
 * о себе сообщил (B179).
 */
interface CareerHomeProps {
  readonly session: AuthUser;
  readonly snapshot?: CandidateSnapshot;
  readonly account?: AccountSnapshot;
  readonly workspace?: CandidateWorkspace;
  readonly targetDirection: string;
  /** Карта ролей и рынка: гипотезы и выборка вакансий за ними (B104, B118). */
  readonly journey?: CareerJourney;
  readonly proposedRoles?: readonly ProposedRole[];
  /** Выбранная роль и её история — «Стратегия» (B180, срез 2). */
  readonly strategy?: CareerStrategyRead;
  /** Задания «Какие роли мне подходят» (B180, срез 3). */
  readonly workPreferences?: WorkPreferencesState;
  readonly poolComplete?: boolean;
  readonly poolTotal?: number;
  readonly loading: boolean;
  readonly importing?: boolean;
  readonly applications?: readonly VacancyApplication[];
  readonly onRefresh: () => Promise<void>;
  readonly onNavigate: (view: CareerCabinetView) => void;
  readonly onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
  readonly onOpenAccount: () => void;
  readonly onOpenExpert: () => void;
}

export function CareerHome(props: CareerHomeProps) {
  const {
    session,
    snapshot,
    account,
    workspace,
    loading,
    importing = false,
    onRefresh,
    onNavigate,
    onUpdateWorkspace,
    onOpenAccount,
    onOpenExpert,
  } = props;
  return (
    <div className="career-home">
      <div className="career-home-main">
        <CareerProfileSurface
          account={account}
          session={session}
          snapshot={snapshot}
          workspace={workspace}
          loading={loading}
          expanded
          onRefresh={onRefresh}
          onUpdateWorkspace={onUpdateWorkspace}
          onOpenAccount={onOpenAccount}
          onOpenExpert={onOpenExpert}
          onOpenResume={() => onNavigate('resume')}
        />
        <HomeFolds {...props} regions={workspace?.regions ?? []} />
      </div>

      <HomeRail {...props} importing={importing} />
    </div>
  );
}

// Правый рельс — только то, что ведёт: следующее действие и оценка. Всё
// остальное (B233) стоит свёрнутым под профилем слева: четыре равных блока
// справа тянулись на полтора экрана, и глазу было некуда сесть.
function HomeRail({
  snapshot,
  targetDirection,
  journey,
  strategy,
  importing,
  applications,
  onNavigate,
}: {
  snapshot?: CandidateSnapshot;
  targetDirection: string;
  journey?: CareerJourney;
  strategy?: CareerStrategyRead;
  importing: boolean;
  applications?: readonly VacancyApplication[];
  onNavigate: (view: CareerCabinetView) => void;
}) {
  return (
    <aside className="career-home-rail" aria-label="Оценка и следующее действие">
      <FollowUpActionCard
        applications={applications}
        onOpenVacancy={() => onNavigate('opportunities')}
      />
      <NextAction journey={journey} onNavigate={onNavigate} />
      <AssessmentPanel
        snapshot={snapshot}
        targetDirection={targetDirection}
        importing={importing}
      />
      {strategy?.error ? (
        <p className="career-cabinet-error" role="alert">
          {strategy.error}
        </p>
      ) : null}
    </aside>
  );
}

// Свёрнутые разделы под профилем: читаемость, роли и рынок, позиционирование,
// консультант. Порядок тот же, что был на рельсе, — файл держит его целиком.
// eslint-disable-next-line max-lines-per-function
function HomeFolds({
  snapshot,
  regions,
  targetDirection,
  journey,
  proposedRoles,
  strategy,
  workPreferences,
  poolComplete,
  poolTotal,
  onNavigate,
  onOpenExpert,
}: {
  snapshot?: CandidateSnapshot;
  regions: readonly CandidateRegion[];
  targetDirection: string;
  journey?: CareerJourney;
  proposedRoles?: readonly ProposedRole[];
  strategy?: CareerStrategyRead;
  workPreferences?: WorkPreferencesState;
  poolComplete?: boolean;
  poolTotal?: number;
  onNavigate: (view: CareerCabinetView) => void;
  onOpenExpert: () => void;
}) {
  const latestTrack = [...(snapshot?.turns ?? [])]
    .reverse()
    .find((turn) => turn.status === 'completed' && turn.result?.careerTrack)?.result?.careerTrack;

  return (
    <div className="career-home-folds">
      <details className="career-home-fold">
        <summary>ATS-читаемость</summary>
        <AtsReadability journey={journey} onNavigate={onNavigate} />
      </details>
      <details className="career-home-fold">
        <summary>Роли и рынок</summary>
        <RolesMarketPanel
          journey={journey}
          proposedRoles={proposedRoles}
          poolComplete={poolComplete}
          poolTotal={poolTotal}
          {...(strategy ? { choice: roleChoice(strategy) } : {})}
          onNavigate={onNavigate}
        />
        {/* Выбранная роль стоит рядом с тем местом, где её выбирают: версия,
            дата, кто назвал и что говорил пул в момент выбора (B180, срез 2). */}
        {strategy ? (
          <CareerStrategyPanel
            strategy={strategy.strategy}
            loading={strategy.loading}
            failed={strategy.failed}
          />
        ) : null}
        {/* Задания стоят под ролями: они уточняют порядок уже найденных ролей,
            а не находят их (B180, срез 3). */}
        {workPreferences ? <WorkPreferencesPanel state={workPreferences} /> : null}
      </details>
      <details className="career-home-fold">
        <summary>Позиционирование</summary>
        <PositioningPanel
          targetDirection={targetDirection}
          regions={regions}
          alternatives={latestTrack?.alternatives}
          onNavigate={onNavigate}
        />
      </details>
      <details className="career-home-fold">
        <summary>Карьерный консультант</summary>
        <ConsultantPanel snapshot={snapshot} onOpenExpert={onOpenExpert} />
      </details>
    </div>
  );
}

/**
 * Ни одного процента без опоры. Кольцо «68 из 100» из макета продукт измерить
 * не может, поэтому здесь стоят только счётные меры, каждая со своим
 * знаменателем, объяснением и датой последнего изменения фактов.
 */
function AssessmentPanel({
  snapshot,
  targetDirection,
  importing,
}: {
  snapshot?: CandidateSnapshot;
  targetDirection: string;
  importing: boolean;
}) {
  const assessment = assessProfile({ view: buildProfileView(snapshot), targetDirection });
  // Пока идёт импорт, серверное чтение кабинета старше его результата: числа
  // факты устарели, а не равны нулю (B160 §3). Экран говорит это прямо, а не
  // печатает вчерашнюю оценку как сегодняшнюю.
  const measures = importing ? [] : assessment.measures;

  return (
    <section className="career-home-panel" aria-labelledby="career-assessment-title">
      <header>
        <h3 id="career-assessment-title">Готовность профиля</h3>
        <span className="career-cabinet-tag" title="Это заполненность, не сила резюме">
          Заполненность, не сила
        </span>
        {assessment.measuredAt && !importing ? (
          <span className="career-cabinet-tag">
            факты обновлены {formatDay(assessment.measuredAt)}
          </span>
        ) : null}
      </header>
      {measures.length === 0 ? (
        <p className="career-home-empty">
          {importing
            ? 'Профиль ещё загружается, оценка обновится после загрузки.'
            : 'Профиль пуст — оценивать нечего. Загрузите резюме или подключите профиль на площадке.'}
        </p>
      ) : (
        <>
          {assessment.score ? <ScoreRing score={assessment.score} /> : null}
          <ul className="career-measure-list">
            {measures.map((measure) => (
              <MeasureRow key={measure.id} measure={measure} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/**
 * Кольцо из макета. Число внутри — доля пройденных проверок, и подпись под ним
 * называет обе величины: «68 из 100» без знаменателя было бы выдумкой.
 */
function ScoreRing({ score }: { score: ProfileScore }) {
  const circumference = 264;
  return (
    <div className="career-score">
      <div
        className="career-score-ring"
        role="img"
        aria-label={`Профиль: пройдено ${score.checks} проверок из ${score.total}`}
      >
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="career-score-track" cx="50" cy="50" r="42" />
          <circle
            className="career-score-value"
            cx="50"
            cy="50"
            r="42"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - (circumference * score.value) / 100}
            transform="rotate(-90 50 50)"
          />
        </svg>
        {/* Число и подпись — в HTML, не в SVG: текст в viewBox масштабируется
            вместе с кольцом и на 96 px выходил 6 px высотой (B232). */}
        <strong className="career-score-number" aria-hidden="true">
          {score.value}
        </strong>
        <span className="career-score-caption" aria-hidden="true">
          из 100
        </span>
      </div>
      <p>
        Пройдено {score.checks} проверок из {score.total}. Каждая проверка ниже называет, из чего
        сложено число.
      </p>
    </div>
  );
}

function MeasureRow({ measure }: { measure: ProfileMeasure }) {
  const share = measure.total > 0 ? measure.value / measure.total : 0;
  return (
    <li className="career-measure">
      <div className="career-measure-head">
        <span>{measure.label}</span>
        <strong>
          {measure.value} из {measure.total}
        </strong>
      </div>
      <div
        className="career-measure-track"
        role="img"
        aria-label={`${measure.label}: ${measure.value} из ${measure.total}`}
      >
        <span
          className="career-measure-fill"
          data-full={share === 1 ? 'true' : undefined}
          data-share={shareStep(share)}
        />
      </div>
      <p>{measure.basis}</p>
    </li>
  );
}

/**
 * Ширина полосы задаётся классом, а не `style`: прод отдаёт
 * `style-src 'self'`, и инлайновый атрибут там молча не применяется.
 */
function shareStep(share: number): string {
  return String(Math.round(share * 10) * 10);
}

/** Как называется роль — и чем это подпёрто. Названия даёт стратег. */
function PositioningPanel({
  targetDirection,
  regions,
  alternatives,
  onNavigate,
}: {
  targetDirection: string;
  regions: readonly CandidateRegion[];
  alternatives?: NonNullable<CoachResult['careerTrack']>['alternatives'];
  onNavigate: (view: CareerCabinetView) => void;
}) {
  const regionLabel = candidateRegionLabels(regions).join(', ');
  return (
    <section className="career-home-panel" aria-labelledby="career-positioning-title">
      <header>
        <h3 id="career-positioning-title">Позиционирование</h3>
      </header>
      <dl className="career-home-facts">
        <div>
          <dt>Как называть роль</dt>
          <dd>{targetDirection.trim() || 'Не названа'}</dd>
        </div>
        <div>
          <dt>Регион поиска</dt>
          <dd>{regionLabel || 'Не выбран'}</dd>
        </div>
      </dl>
      <StrategistNames alternatives={alternatives} />
      <button className="career-quiet-button" type="button" onClick={() => onNavigate('career')}>
        Перейти в «Поиск» <ArrowRight size={16} aria-hidden="true" />
      </button>
    </section>
  );
}

/** Смежные названия роли — только от стратега, своего словаря ролей нет. */
function StrategistNames({
  alternatives,
}: {
  alternatives?: NonNullable<CoachResult['careerTrack']>['alternatives'];
}) {
  if (!alternatives?.length) {
    return (
      <p className="career-home-empty">
        Смежные названия роли появятся после разговора с консультантом.
      </p>
    );
  }
  return (
    <>
      <p className="career-cabinet-tag">Смежные названия роли</p>
      <ul className="career-home-pills">
        {alternatives.map((alternative) => (
          <li key={alternative.label}>{alternative.label}</li>
        ))}
      </ul>
    </>
  );
}

/**
 * Диалог живёт в одном месте — в панели советника (B148 §9). Здесь только его
 * последняя реплика и дверь туда, чтобы «Главная» не стала вторым чатом.
 */
function ConsultantPanel({
  snapshot,
  onOpenExpert,
}: {
  snapshot?: CandidateSnapshot;
  onOpenExpert: () => void;
}) {
  const lastAnswer = [...(snapshot?.messages ?? [])]
    .reverse()
    .find((message) => message.role === 'assistant');

  return (
    <section className="career-home-panel" aria-labelledby="career-consultant-title">
      <header>
        <h3 id="career-consultant-title">Карьерный консультант</h3>
      </header>
      {lastAnswer ? (
        <blockquote className="career-home-quote">{lastAnswer.content}</blockquote>
      ) : (
        <p className="career-home-empty">
          Разговора ещё не было. Консультант разбирает факты и объясняет, что в них читается, а что
          нет.
        </p>
      )}
      <button className="career-btn career-btn-secondary" type="button" onClick={onOpenExpert}>
        <ChatCircleDots size={17} />
        {lastAnswer ? 'Продолжить разговор' : 'Начать разговор'}
      </button>
    </section>
  );
}

function formatDay(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
  }).format(new Date(value));
}

/** Выбор роли и его состояние — одним объектом, как их читает панель. */
function roleChoice(strategy: CareerStrategyRead): RoleChoiceActions {
  return {
    ...(strategy.strategy ? { chosenTitle: strategy.strategy.current.role.title } : {}),
    saving: strategy.saving,
    onChoose: (title, reason) => void strategy.choose(title, reason),
  };
}
