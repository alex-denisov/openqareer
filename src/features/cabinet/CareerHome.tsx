import { ArrowRight, ChatCircleDots } from '@phosphor-icons/react';
import type {
  AccountSnapshot,
  AuthUser,
  CandidateSnapshot,
  CoachResult,
} from '../coach/coachApi';
import type { CandidateWorkspace } from '../workspace/workspaceStorage';
import {
  candidateRegionLabels,
  type CandidateRegion,
} from '../workspace/candidateRegions';
import { CareerProfileSurface } from './CareerProfileSurface';
import { assessProfile, type ProfileMeasure, type ProfileScore } from './profileAssessment';
import { buildProfileView } from './profileView';
import type { CareerCabinetView } from './cabinetViews';

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
  readonly loading: boolean;
  readonly importing?: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly onNavigate: (view: CareerCabinetView) => void;
  readonly onUpdateWorkspace: (workspace: CandidateWorkspace) => void;
  readonly onOpenAccount: () => void;
  readonly onOpenExpert: () => void;
}

export function CareerHome({
  session,
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
          onOpenExpert={onOpenExpert}
          onOpenResume={() => onNavigate('resume')}
        />
      </div>

      <HomeRail
        snapshot={snapshot}
        regions={workspace?.regions ?? []}
        targetDirection={targetDirection}
        importing={importing}
        onNavigate={onNavigate}
        onOpenExpert={onOpenExpert}
      />
    </div>
  );
}

/** Правый рельс: что делать дальше, чем подпёрто и кто это разбирает. */
function HomeRail({
  snapshot,
  regions,
  targetDirection,
  importing,
  onNavigate,
  onOpenExpert,
}: {
  snapshot?: CandidateSnapshot;
  regions: readonly CandidateRegion[];
  targetDirection: string;
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
        <h3 id="career-assessment-title">Оценка профиля</h3>
        {assessment.measuredAt && !importing ? (
          <span className="career-cabinet-tag">
            факты обновлены {formatDay(assessment.measuredAt)}
          </span>
        ) : null}
      </header>
      {measures.length === 0 ? (
        <p className="career-home-empty">
          {importing
            ? 'Пока идёт импорт профиля, оценка не пересчитывается: числа старше того, что уже пришло.'
            : 'Профиль пуст — оценивать нечего. Импортируйте резюме или разберите его с консультантом.'}
        </p>
      ) : (
        <>
          {assessment.score ? <ScoreRing score={assessment.score} /> : null}
          <ul className="career-measure-list">
            {measures.map((measure) => (
              <MeasureRow key={measure.id} measure={measure} />
            ))}
          </ul>
          <p className="career-cabinet-tag">
            посчитано по вашему профилю · метод {assessment.methodVersion}
          </p>
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
      <svg
        width="96"
        height="96"
        viewBox="0 0 100 100"
        role="img"
        aria-label={`Профиль: пройдено ${score.checks} проверок из ${score.total}`}
      >
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
        <text className="career-score-number" x="50" y="47" textAnchor="middle">
          {score.value}
        </text>
        <text className="career-score-caption" x="50" y="63" textAnchor="middle">
          ИЗ 100
        </text>
      </svg>
      <p>
        Пройдено {score.checks} проверок из {score.total}. Каждая проверка ниже
        называет, из чего сложено число.
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
