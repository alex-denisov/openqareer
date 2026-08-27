import { ArrowRight, Compass, TrendUp } from '@phosphor-icons/react';
import type { AccountSnapshot, CandidateSnapshot } from '../coach/coachApi';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { CareerCabinetView } from './cabinetViews';
import {
  candidateRegionLabels,
  type CandidateRegion,
} from '../workspace/candidateRegions';
import { pluralRu } from '../../../shared/pluralRu';

/**
 * «Карьера» — where the candidate is going and how they will know they arrived.
 * Extracted from the cabinet container so the route can change without reading
 * every other section (B148 §11).
 */
interface CareerTrackBoardProps {
  readonly journey?: CareerJourney;
  readonly snapshot?: CandidateSnapshot;
  readonly account?: AccountSnapshot;
  readonly targetDirection: string;
  readonly regions: readonly CandidateRegion[];
  readonly onNavigate: (view: CareerCabinetView) => void;
  readonly onEditPremises: () => void;
}

export function CareerTrackBoard({
  journey,
  snapshot,
  account,
  targetDirection,
  regions,
  onNavigate,
  onEditPremises,
}: CareerTrackBoardProps) {
  const latestTrack = [...(snapshot?.turns ?? [])]
    .reverse()
    .find((turn) => turn.status === 'completed' && turn.result?.careerTrack)?.result
    ?.careerTrack;
  return (
    <section className="career-track-board" aria-labelledby="career-track-board-title">
      <header>
        <div>
          <span className="career-cabinet-kicker">Измеримый маршрут</span>
          <h2 id="career-track-board-title">
            {latestTrack?.objective ?? 'Карьерная гипотеза формируется'}
          </h2>
        </div>
        <TrendUp size={24} />
      </header>

      <TrackTimeline
        items={latestTrack?.milestones ?? journey?.track ?? []}
        empty={!latestTrack && !journey}
      />
      <CareerRoutePremises
        targetRole={targetDirection}
        regions={regions}
        workMode={account?.profile.workMode ?? undefined}
        onEdit={onEditPremises}
      />
      <RoleHypotheses journey={journey} />

      <button className="career-primary-button" type="button" onClick={() => onNavigate('profile')}>
        Укрепить профиль <ArrowRight size={17} />
      </button>
    </section>
  );
}

/**
 * The route's geography is where the candidate said they are looking, not
 * where they live. This row used to read the account's residence and so wrote
 * «Не указана» while the server held the wizard's own answer (B158, B160).
 */
export function CareerRoutePremises({
  targetRole,
  regions,
  workMode,
  onEdit,
}: {
  targetRole?: string;
  regions: readonly CandidateRegion[];
  workMode?: AccountSnapshot['profile']['workMode'];
  onEdit: () => void;
}) {
  return (
    <section className="career-route-premises" aria-labelledby="career-route-premises-title">
      <header>
        <div>
          <span className="career-cabinet-kicker">Изменяемые предпосылки</span>
          <h3 id="career-route-premises-title">Роль и условия маршрута</h3>
        </div>
        <button type="button" onClick={onEdit}>
          Изменить роль и условия
        </button>
      </header>
      <dl>
        <div>
          <dt>Роль и уровень</dt>
          <dd>{targetRole?.trim() || 'Уточняются'}</dd>
        </div>
        <div>
          <dt>География</dt>
          <dd>
            {candidateRegionLabels(regions).join(', ') || 'Регионы не выбраны'}
          </dd>
        </div>
        <div>
          <dt>Формат работы</dt>
          <dd>{routeWorkModeLabel(workMode)}</dd>
        </div>
      </dl>
      <p>
        После сохранения гипотезы и поисковый запрос пересчитываются; прошлые
        варианты остаются обратимыми.
      </p>
    </section>
  );
}

type CareerTrackItem =
  | CareerJourney['track'][number]
  | {
      label: string;
      successCriterion: string;
      measureAfter: string;
      expectedSignal: string;
    };

function TrackTimeline({ items, empty }: { items: CareerTrackItem[]; empty: boolean }) {
  return (
    <div className="career-track-timeline">
      {items.map((item, index) => {
        const milestone = 'expectedSignal' in item;
        return (
          <article key={milestone ? `${item.label}-${item.measureAfter}` : item.id}>
            <span>{index + 1}</span>
            <div>
              <strong>{item.label}</strong>
              <p>{milestone ? item.successCriterion : item.reason}</p>
              <small>
                {milestone
                  ? `Проверка ${formatDate(item.measureAfter)} · ${item.expectedSignal}`
                  : trackStatus(item.status)}
              </small>
            </div>
          </article>
        );
      })}
      {empty ? (
        <article>
          <span>1</span>
          <div>
            <strong>Подтвердить профиль</strong>
            <p>Нужны опыт, результат и карьерное ограничение.</p>
            <small>Ожидает данных</small>
          </div>
        </article>
      ) : null}
    </div>
  );
}

function RoleHypotheses({ journey }: { journey?: CareerJourney }) {
  return (
    <section className="career-role-hypotheses">
      <header>
        <h3>Рабочие роли</h3>
        <span>{journey?.roles.length ?? 0}</span>
      </header>
      {journey?.roles.length ? (
        journey.roles.map((role) => (
          <article key={role.id}>
            <Compass size={18} />
            <div>
              <strong>{role.title}</strong>
              <p>{role.basis}</p>
              <small>
                {pluralRu(role.evidenceCount, [
                  'подтверждённая опора',
                  'подтверждённые опоры',
                  'подтверждённых опор',
                ])}{' '}
                · {pluralRu(role.gaps.length, ['пробел', 'пробела', 'пробелов'])}
              </small>
            </div>
          </article>
        ))
      ) : (
        <p>Роли появятся после подтверждения минимум одного карьерного эпизода.</p>
      )}
    </section>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${value}T00:00:00Z`));
}

function trackStatus(status: CareerJourney['track'][number]['status']): string {
  return { complete: 'Готово', active: 'В работе', waiting: 'Ожидает' }[status];
}

function routeWorkModeLabel(mode?: AccountSnapshot['profile']['workMode']): string {
  if (!mode) return 'Не указан';
  return { remote: 'Удалённо', hybrid: 'Гибрид', office: 'Офис', flexible: 'Гибко' }[mode];
}
