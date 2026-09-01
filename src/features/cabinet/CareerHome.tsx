import { ArrowRight, ChatCircleDots } from '@phosphor-icons/react';
import type {
  AccountSnapshot,
  AuthUser,
  CandidateSnapshot,
  CoachResult,
} from '../coach/coachApi';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import {
  candidateRegionLabels,
  type CandidateRegion,
} from '../workspace/candidateRegions';
import { CareerProfileSurface } from './CareerProfileSurface';
import { NextActionCard } from './NextActionCard';
import { assessProfile, type ProfileMeasure } from './profileAssessment';
import type { CareerCabinetView } from './cabinetViews';

/**
 * «Главная» — кандидат и его досье слева, оценка, позиционирование и вход к
 * консультанту справа («Пульт», решение владельца 2026-08-31).
 *
 * Раньше первый экран кабинета («Сегодня») только рекомендовал следующий шаг,
 * а сам кандидат — его имя, роль, опыт и факты — жил в отдельном разделе
 * «Профиль». Владелец назвал это прямо: на «Главной» должен быть профиль
 * кандидата. Досье переехало сюда целиком, вместе со своей очередью
 * подтверждения, а рекомендация встала в правый рельс, где ей и место рядом с
 * оценкой.
 */
interface CareerHomeProps {
  readonly name: string;
  readonly session: AuthUser;
  readonly journey?: CareerJourney;
  readonly snapshot?: CandidateSnapshot;
  readonly account?: AccountSnapshot;
  readonly workspace?: CandidateWorkspace;
  readonly targetDirection: string;
  readonly loading: boolean;
  readonly importing?: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onNavigate: (view: CareerCabinetView) => void;
  readonly onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
  readonly onOpenAccount: () => void;
  readonly onOpenExpert: () => void;
}

export function CareerHome({
  name,
  session,
  journey,
  snapshot,
  account,
  workspace,
  targetDirection,
  loading,
  importing = false,
  onRefresh,
  onNavigate,
  onUpdateWorkspace,
  onOpenAccount,
  onOpenExpert,
}: CareerHomeProps) {
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
        />
      </div>

      <HomeRail
        name={name}
        journey={journey}
        snapshot={snapshot}
        regions={workspace?.regions ?? []}
        targetDirection={targetDirection}
        loading={loading}
        importing={importing}
        onNavigate={onNavigate}
        onOpenExpert={onOpenExpert}
      />
    </div>
  );
}

/** Правый рельс: что делать дальше, чем подпёрто и кто это разбирает. */
function HomeRail({
  name,
  journey,
  snapshot,
  regions,
  targetDirection,
  loading,
  importing,
  onNavigate,
  onOpenExpert,
}: {
  name: string;
  journey?: CareerJourney;
  snapshot?: CandidateSnapshot;
  regions: readonly CandidateRegion[];
  targetDirection: string;
  loading: boolean;
  importing: boolean;
  onNavigate: (view: CareerCabinetView) => void;
  onOpenExpert: () => void;
}) {
  const latestTrack = [...(snapshot?.turns ?? [])]
    .reverse()
    .find((turn) => turn.status === 'completed' && turn.result?.careerTrack)
    ?.result?.careerTrack;

  return (
    <aside className="career-home-rail" aria-label="Оценка и позиционирование">
      <NextActionCard
        name={name}
        journey={journey}
        loading={loading}
        importing={importing}
        onNavigate={onNavigate}
        onOpenExpert={onOpenExpert}
      />
      <AssessmentPanel
        snapshot={snapshot}
        targetDirection={targetDirection}
        importing={importing}
      />
      <PositioningPanel
        targetDirection={targetDirection}
        regions={regions}
        alternatives={latestTrack?.alternatives}
        onNavigate={onNavigate}
      />
      <ConsultantPanel snapshot={snapshot} onOpenExpert={onOpenExpert} />
    </aside>
  );
}

/**
 * Ни одного процента без опоры. Кольцо «68 из 100» из макета продукт измерить
 * не может, поэтому здесь стоят только счётные меры, каждая со своим
 * знаменателем, объяснением и датой последнего изменения досье.
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
  const assessment = assessProfile({
    memory: snapshot?.memory ?? [],
    targetDirection,
  });
  // Пока идёт импорт, серверное чтение кабинета старше его результата: числа
  // досье устарели, а не равны нулю (B160 §3). Экран говорит это прямо, а не
  // печатает вчерашнюю оценку как сегодняшнюю.
  const measures = importing ? [] : assessment.measures;

  return (
    <section className="career-home-panel" aria-labelledby="career-assessment-title">
      <header>
        <h3 id="career-assessment-title">Оценка досье</h3>
        {assessment.measuredAt && !importing ? (
          <span className="career-cabinet-tag">
            досье изменено {formatDay(assessment.measuredAt)}
          </span>
        ) : null}
      </header>
      {measures.length === 0 ? (
        <p className="career-home-empty">
          {importing
            ? 'Пока идёт импорт профиля, оценка не пересчитывается: числа досье старше того, что уже пришло.'
            : 'Нет подтверждённых фактов — оценивать нечего. Импортируйте резюме или разберите его с консультантом.'}
        </p>
      ) : (
        <>
          <ul className="career-measure-list">
            {measures.map((measure) => (
              <MeasureRow key={measure.id} measure={measure} />
            ))}
          </ul>
          <p className="career-cabinet-tag">
            посчитано по вашему досье · метод {assessment.methodVersion}
          </p>
        </>
      )}
    </section>
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
      <button
        className="career-quiet-button"
        type="button"
        onClick={() => onNavigate('career')}
      >
        Открыть «Карьеру» <ArrowRight size={16} />
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
        Смежные названия появятся после разбора со стратегом. Своего словаря
        ролей у продукта нет.
      </p>
    );
  }
  return (
    <>
      <p className="career-cabinet-tag">стратег держит рядом</p>
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
          Разговора ещё не было. Консультант разбирает факты и объясняет, что в
          них читается, а что нет.
        </p>
      )}
      <button className="career-primary-button" type="button" onClick={onOpenExpert}>
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
