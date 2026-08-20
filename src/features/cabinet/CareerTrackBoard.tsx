import { ArrowRight, Compass, TrendUp } from '@phosphor-icons/react';
import type { AccountSnapshot, CandidateSnapshot } from '../coach/coachApi';
import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { CareerCabinetView } from './cabinetViews';

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
  readonly onNavigate: (view: CareerCabinetView) => void;
  readonly onEditPremises: () => void;
}

export function CareerTrackBoard({
  journey,
  snapshot,
  account,
  targetDirection,
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
        location={account?.profile.location ?? undefined}
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

export function CareerRoutePremises({
  targetRole,
  location,
  workMode,
  onEdit,
}: {
  targetRole?: string;
  location?: string;
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
          <dd>{location?.trim() || 'Не указана'}</dd>
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
                {role.evidenceCount} подтверждённых опор · {role.gaps.length} пробелов
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
