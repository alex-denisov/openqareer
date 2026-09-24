import type { CareerJourney } from '../journey/careerJourneyEngine';

/**
 * A narrow subset of `ShellSection`/`CareerCabinetView` — the only screens a
 * step ever opens. Narrow on purpose: this lets the indicator be reused by
 * both the anonymous-workspace shell and the authenticated cabinet, whose
 * `onNavigate` callbacks accept different (but overlapping) view unions.
 */
export type PathDestination = 'profile' | 'career' | 'opportunities';

/**
 * B248 — the cross-screen path indicator: Профиль → Роль → Подборка →
 * Отклики → Интервью (`career-consultant-notes.md` §2).
 *
 * Three states only, never a fourth decorative one: «не начат», «в процессе»,
 * «готов». A step that has no data source at all (there is no interview
 * tracking yet, B251 is not built) stays neutral — «не начат» with an honest
 * reason — rather than guessing.
 */
export type PathStepId = 'profile' | 'role' | 'shortlist' | 'responses' | 'interviews';
export type PathStepState = 'not-started' | 'in-progress' | 'done';

export interface PathStep {
  readonly id: PathStepId;
  readonly label: string;
  readonly state: PathStepState;
  /** Why the step is not «готов» yet, in the candidate's language. */
  readonly reason: string;
  /** Nearest existing screen the step opens on click. */
  readonly destination: PathDestination;
}

type TrackItem = NonNullable<CareerJourney['track']>[number];

export interface PathIndicatorInput {
  /** `journey.track`, when a career journey already exists. */
  readonly track?: readonly TrackItem[];
  /** Size of the matched vacancy pool — the campaign's actual output. */
  readonly matchedPoolCount: number;
  /** Applications the candidate confirmed (`status === 'applied'`). */
  readonly confirmedApplications: number;
  /**
   * Cards still on the responses board (any stage that isn't `rejected`/
   * `archived`). Drives the «Отклики» step once the candidate has a live
   * pipeline, not just a first confirmed application (B251 S4).
   */
  readonly activeResponses?: number;
  /** The candidate's next scheduled interview, when the tracker has one. */
  readonly nearestInterview?: { readonly company: string; readonly scheduledAt: string } | null;
}

const NO_JOURNEY_REASON = 'Резюме не загружено';
const NO_INTERVIEW_DATA_REASON = 'Интервью не назначено';

function formatInterviewReason(scheduledAt: string): string {
  const date = new Date(scheduledAt);
  if (Number.isNaN(date.getTime())) return 'Дата уточняется';
  const weekday = new Intl.DateTimeFormat('ru-RU', { weekday: 'long' }).format(date);
  const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(date);
  return `${weekday}, ${time}`;
}

function trackState(item: TrackItem | undefined): PathStepState {
  if (!item) return 'not-started';
  if (item.status === 'complete') return 'done';
  if (item.status === 'active') return 'in-progress';
  return 'not-started';
}

function findTrackItem(
  track: readonly TrackItem[] | undefined,
  id: TrackItem['id'],
): TrackItem | undefined {
  return track?.find((item) => item.id === id);
}

function shortlistStepOf(input: PathIndicatorInput): PathStep {
  const campaignState = trackState(findTrackItem(input.track, 'campaign'));
  const state: PathStepState =
    input.matchedPoolCount > 0 ? 'done' : campaignState === 'not-started' ? 'not-started' : 'in-progress';
  return {
    id: 'shortlist',
    label: 'Подборка',
    state,
    reason:
      state === 'done' ? 'Кампания вернула вакансии' : 'Кампания не запущена или пул по роли пуст',
    destination: 'opportunities',
  };
}

function responsesStepOf(input: PathIndicatorInput): PathStep {
  const active = input.activeResponses ?? 0;
  // A live pipeline is «you are here», not «done» — «done» stayed for the
  // wizard-only workspace, which has no board and only knows a first
  // confirmed application (B251 S4, accepted screenshot review).
  const state: PathStepState = active > 0 ? 'in-progress' : input.confirmedApplications > 0 ? 'done' : 'not-started';
  const reason =
    state === 'in-progress'
      ? `${active} в работе — вы здесь`
      : state === 'done'
        ? 'Есть подтверждённый отклик'
        : 'Откликов нет — начните с очереди дня';
  return { id: 'responses', label: 'Отклики', state, reason, destination: 'opportunities' };
}

function interviewsStepOf(input: PathIndicatorInput): PathStep {
  if (input.nearestInterview) {
    return {
      id: 'interviews',
      label: 'Интервью',
      state: 'in-progress',
      reason: `${input.nearestInterview.company} · ${formatInterviewReason(input.nearestInterview.scheduledAt)}`,
      destination: 'opportunities',
    };
  }
  return {
    id: 'interviews',
    label: 'Интервью',
    state: 'not-started',
    reason: NO_INTERVIEW_DATA_REASON,
    destination: 'opportunities',
  };
}

/**
 * Builds the five steps from data the product already has. Nothing here is
 * invented: a step without a source stays «не начат» with a plain reason.
 */
export function buildPathIndicator(input: PathIndicatorInput): readonly PathStep[] {
  const profileItem = findTrackItem(input.track, 'career-picture');
  const roleItem = findTrackItem(input.track, 'role-market');

  return [
    {
      id: 'profile',
      label: 'Профиль',
      state: trackState(profileItem),
      reason: profileItem?.reason ?? NO_JOURNEY_REASON,
      destination: 'profile',
    },
    {
      id: 'role',
      label: 'Роль',
      state: trackState(roleItem),
      reason: roleItem?.reason ?? 'Роль не выбрана',
      destination: 'career',
    },
    shortlistStepOf(input),
    responsesStepOf(input),
    interviewsStepOf(input),
  ];
}
