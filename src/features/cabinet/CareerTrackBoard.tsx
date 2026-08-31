import { useState } from 'react';
import { ArrowRight, Compass, TrendUp } from '@phosphor-icons/react';
import type { AccountSnapshot, CandidateSnapshot, CoachResult } from '../coach/coachApi';
import { CareerRoutePremisesEditor } from './CareerRoutePremisesEditor';
import type { RoutePremisesDraft } from './routePremises';
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
  /** The premises as they stand now, read from both stores that hold them. */
  readonly premises: RoutePremisesDraft;
  /**
   * True while the cabinet is still reading the account. Opening the editor
   * then would show empty fields over answers the server holds, and saving
   * would write that emptiness back (found on the B160 production walk).
   */
  readonly premisesLoading: boolean;
  readonly onNavigate: (view: CareerCabinetView) => void;
  /**
   * Applies the edited premises. Resolves once both stores have accepted them,
   * rejects with the message the candidate should read.
   */
  readonly onSavePremises: (draft: RoutePremisesDraft) => Promise<void>;
}

export function CareerTrackBoard({
  journey,
  snapshot,
  account,
  targetDirection,
  regions,
  premises,
  premisesLoading,
  onNavigate,
  onSavePremises,
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
      <RoutePremisesPanel
        targetRole={targetDirection}
        regions={regions}
        workMode={account?.profile.workMode ?? null}
        premises={premises}
        loading={premisesLoading}
        onSave={onSavePremises}
      />
      <RoleHypotheses alternatives={latestTrack?.alternatives} />

      <button className="career-primary-button" type="button" onClick={() => onNavigate('profile')}>
        Укрепить профиль <ArrowRight size={17} />
      </button>
    </section>
  );
}

/**
 * Reading and changing the premises are the same place. The edit button used
 * to open the «Аккаунт» panel, which carries no role, no regions and no work
 * mode, so the premises were readable and unchangeable (B160).
 */
function RoutePremisesPanel({
  targetRole,
  regions,
  workMode,
  premises,
  loading,
  onSave,
}: {
  targetRole?: string;
  regions: readonly CandidateRegion[];
  workMode: AccountSnapshot['profile']['workMode'];
  premises: RoutePremisesDraft;
  loading: boolean;
  onSave: (draft: RoutePremisesDraft) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  if (!editing) {
    return (
      <CareerRoutePremises
        targetRole={targetRole}
        regions={regions}
        workMode={workMode ?? undefined}
        editDisabled={loading}
        onEdit={() => {
          setError(undefined);
          setEditing(true);
        }}
      />
    );
  }

  return (
    <CareerRoutePremisesEditor
      initial={premises}
      saving={saving}
      error={error}
      onCancel={() => setEditing(false)}
      onSave={(draft) => {
        setSaving(true);
        setError(undefined);
        void onSave(draft)
          .then(() => setEditing(false))
          .catch((reason: unknown) => setError(premisesSaveError(reason)))
          .finally(() => setSaving(false));
      }}
    />
  );
}

function premisesSaveError(reason: unknown): string {
  return reason instanceof Error
    ? `Предпосылки не сохранены: ${reason.message}`
    : 'Предпосылки не сохранены. Повторите попытку.';
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
  editDisabled = false,
  onEdit,
}: {
  targetRole?: string;
  regions: readonly CandidateRegion[];
  workMode?: AccountSnapshot['profile']['workMode'];
  editDisabled?: boolean;
  onEdit: () => void;
}) {
  return (
    <section className="career-route-premises" aria-labelledby="career-route-premises-title">
      <header>
        <div>
          <span className="career-cabinet-kicker">Изменяемые предпосылки</span>
          <h3 id="career-route-premises-title">Роль и условия маршрута</h3>
        </div>
        <button type="button" onClick={onEdit} disabled={editDisabled}>
          {editDisabled ? 'Читаем текущие ответы…' : 'Изменить роль и условия'}
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

/**
 * Роли называет `career_strategist`, а не локальный словарь: до B178 среза 2
 * здесь печатался вывод таблицы «ключевое слово → две должности», пока панель
 * советника на том же профиле называла другие роли. Нет вывода стратега —
 * ролей нет; выдумывать название продукт не имеет права.
 */
function RoleHypotheses({
  alternatives,
}: {
  alternatives?: NonNullable<CoachResult['careerTrack']>['alternatives'];
}) {
  return (
    <section className="career-role-hypotheses">
      <header>
        <h3>Рабочие роли</h3>
        <span>{alternatives?.length ?? 0}</span>
      </header>
      {alternatives?.length ? (
        alternatives.map((alternative, index) => (
          <article key={`${index}:${alternative.label}`}>
            <Compass size={18} />
            <div>
              <strong>{alternative.label}</strong>
              <p>{alternative.reason}</p>
              <small>
                {pluralRu(alternative.evidenceRefs.length, [
                  'подтверждённая опора',
                  'подтверждённые опоры',
                  'подтверждённых опор',
                ])}
                {alternative.unknowns.length
                  ? ` · ${alternative.unknowns.join(' ')}`
                  : ''}
              </small>
            </div>
          </article>
        ))
      ) : (
        <p>
          Роли назовёт карьерный стратег после разбора подтверждённых фактов.
          Своего словаря ролей у продукта нет.
        </p>
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
