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
}

const NO_JOURNEY_REASON = 'Резюме не загружено';
const NO_INTERVIEW_DATA_REASON = 'Интервью не назначено';

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
  // Пул — не финальный шаг: как только появился первый подтверждённый отклик,
  // кандидат ушёл дальше по пути, и «Подборка» становится пройденной. До
  // этого момента непустой пул — это «вы здесь», а не готовый чекбокс
  // (приёмка B250: подборка отмечалась галкой, пока кандидат ещё выбирает).
  const state: PathStepState =
    input.confirmedApplications > 0
      ? 'done'
      : input.matchedPoolCount > 0
        ? 'in-progress'
        : campaignState === 'not-started'
          ? 'not-started'
          : 'in-progress';
  return {
    id: 'shortlist',
    label: 'Подборка',
    state,
    reason:
      state === 'done'
        ? 'Кампания вернула вакансии'
        : input.matchedPoolCount > 0
          ? `${input.matchedPoolCount} в подборке — вы здесь`
          : 'Кампания не запущена или пул по роли пуст',
    destination: 'opportunities',
  };
}

function responsesStepOf(input: PathIndicatorInput): PathStep {
  const state: PathStepState = input.confirmedApplications > 0 ? 'done' : 'not-started';
  return {
    id: 'responses',
    label: 'Отклики',
    state,
    reason: state === 'done' ? 'Есть подтверждённый отклик' : 'Откликов нет — начните с очереди дня',
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

  const steps: readonly PathStep[] = [
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
    {
      id: 'interviews',
      label: 'Интервью',
      state: 'not-started',
      reason: NO_INTERVIEW_DATA_REASON,
      destination: 'opportunities',
    },
  ];

  return keepSingleCurrentStep(steps);
}

/**
 * Каждый шаг сейчас считается своим источником данных независимо от
 * остальных, и это может честно дать «в процессе» сразу двум шагам (например
 * «Роль» ещё активна в движке, а «Подборка» уже видит непустой пул). Кандидат
 * не может одновременно быть на двух шагах пути — только первый из них
 * остаётся «в процессе», следующие откатываются в «не начат» (приёмка B250).
 */
function keepSingleCurrentStep(steps: readonly PathStep[]): readonly PathStep[] {
  let seenCurrent = false;
  return steps.map((step) => {
    if (step.state !== 'in-progress') return step;
    if (!seenCurrent) {
      seenCurrent = true;
      return step;
    }
    return { ...step, state: 'not-started' };
  });
}
