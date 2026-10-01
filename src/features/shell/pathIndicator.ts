import type { CareerJourney } from '../journey/careerJourneyEngine';
import type { ApplicationStage } from '../../../shared/applicationStage';

/**
 * A narrow subset of `ShellSection`/`CareerCabinetView` — the only screens a
 * step ever opens. Narrow on purpose: this lets the indicator be reused by
 * both the anonymous-workspace shell and the authenticated cabinet, whose
 * `onNavigate` callbacks accept different (but overlapping) view unions.
 */
export type PathDestination = 'profile' | 'career' | 'opportunities' | 'responses';

export interface NavigationOptions {
  readonly stage?: ApplicationStage;
}

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
  /** Whether this step corresponds to the currently open screen. */
  readonly isCurrent: boolean;
  /** Why the step is not «готов» yet, in the candidate's language. */
  readonly reason: string;
  /** Nearest existing screen the step opens on click. */
  readonly destination: PathDestination;
  /** D15: Параметры навигации (например, фильтр этапа 'interview'). */
  readonly navigationOptions?: NavigationOptions;
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
  /**
   * C73: The currently open section/view. Defines which step is «текущий».
   * On 'today' (or unrecognised), no step is current.
   */
  readonly activeSection?: string;
  /** C73: Whether responses contain any application in interview stage. */
  readonly hasInterviewStage?: boolean;
}


const NO_JOURNEY_REASON = 'Нет данных';
const NO_INTERVIEW_DATA_REASON = 'Не назначено';

/** Сокращает подпись статуса шага до ≤ 14 символов (D9: например «Собираем», «Готово», «Нет данных»). */
export function compactReason(rawReason: string | undefined): string {
  if (!rawReason) return 'Нет данных';
  if (rawReason.length <= 14) return rawReason;
  if (rawReason.startsWith('Собираем')) return 'Собираем';
  if (rawReason.startsWith('Опорные факты') || rawReason.startsWith('Ролевая гипотеза')) return 'Готово';
  if (rawReason.startsWith('Сверяем') || rawReason.startsWith('Проверяем')) return 'Проверяем';
  if (rawReason.startsWith('Ждёт')) return 'Ждёт опыта';
  if (rawReason.startsWith('Резюме не') || rawReason.startsWith('Нет данных')) return 'Нет данных';
  if (rawReason.startsWith('Роль не')) return 'Не выбрана';
  if (rawReason.startsWith('Кампания вернула')) return 'Готово';
  if (rawReason.startsWith('Кампания не') || rawReason.includes('пул по роли')) return 'Пул пуст';
  if (rawReason.startsWith('Есть подтверждённый') || rawReason.startsWith('Есть отклик')) return 'Есть отклик';
  if (rawReason.startsWith('Откликов нет')) return 'Нет откликов';
  if (rawReason.startsWith('Интервью не')) return 'Не назначено';
  return rawReason.slice(0, 14).trim();
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

/**
 * C73: Maps an open section to its current path step.
 * On «Сегодня» (or when undefined/tariffs), no step is current.
 * Exactly one step is current on every campaign screen.
 */
export function currentStepForSection(
  section: string | undefined,
  options?: {
    readonly hasInterviewStage?: boolean;
    readonly nearestInterview?: { readonly company: string; readonly scheduledAt: string } | null;
  },
): PathStepId | null {
  if (!section || section === 'today' || section === 'tariffs') {
    return null;
  }
  if (section === 'profile' || section === 'resume') {
    return 'profile';
  }
  if (section === 'career') {
    return 'role';
  }
  if (section === 'opportunities') {
    return 'shortlist';
  }
  if (section === 'responses') {
    if (options?.hasInterviewStage || Boolean(options?.nearestInterview)) {
      return 'interviews';
    }
    return 'responses';
  }
  return null;
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
    isCurrent: false,
    reason:
      state === 'done'
        ? 'Готово'
        : input.matchedPoolCount > 0
          ? `${input.matchedPoolCount} в подборке`.length <= 14
            ? `${input.matchedPoolCount} в подборке`
            : `${input.matchedPoolCount} в пуле`
          : 'Пул пуст',
    destination: 'opportunities',
  };
}

function responsesStepOf(input: PathIndicatorInput): PathStep {
  const active = input.activeResponses ?? 0;
  // A live pipeline is «you are here», not «done» — «done» stayed for the
  // wizard-only workspace, which has no board and only knows a first
  // confirmed application (B251 S4, accepted screenshot review).
  const state: PathStepState =
    active > 0 ? 'in-progress' : input.confirmedApplications > 0 ? 'done' : 'not-started';
  const reason =
    state === 'in-progress'
      ? `${active} в работе`
      : state === 'done'
        ? 'Есть отклик'
        : 'Нет откликов';
  return {
    id: 'responses',
    label: 'Отклики',
    state,
    isCurrent: false,
    reason,
    destination: 'responses',
  };
}

function interviewsStepOf(input: PathIndicatorInput): PathStep {
  if (input.nearestInterview) {
    const comp = input.nearestInterview.company;
    const reason = comp.length <= 14 ? comp : 'Назначено';
    return {
      id: 'interviews',
      label: 'Интервью',
      state: 'in-progress',
      isCurrent: false,
      reason,
      destination: 'responses',
      navigationOptions: { stage: 'interview' },
    };
  }
  return {
    id: 'interviews',
    label: 'Интервью',
    state: 'not-started',
    isCurrent: false,
    reason: NO_INTERVIEW_DATA_REASON,
    destination: 'responses',
    navigationOptions: { stage: 'interview' },
  };
}

/**
 * Builds the five steps from data the product already has. Nothing here is
 * invented: a step without a source stays «не начат» with a plain reason.
 */
export function buildPathIndicator(input: PathIndicatorInput): readonly PathStep[] {
  const profileItem = findTrackItem(input.track, 'career-picture');
  const roleItem = findTrackItem(input.track, 'role-market');

  const rawSteps: readonly PathStep[] = [
    {
      id: 'profile',
      label: 'Профиль',
      state: trackState(profileItem),
      isCurrent: false,
      reason: compactReason(profileItem?.reason ?? NO_JOURNEY_REASON),
      destination: 'profile',
    },
    {
      id: 'role',
      label: 'Роль',
      state: trackState(roleItem),
      isCurrent: false,
      reason: compactReason(roleItem?.reason ?? 'Не выбрана'),
      destination: 'career',
    },
    shortlistStepOf(input),
    responsesStepOf(input),
    interviewsStepOf(input),
  ];

  const stepsWithSequentialState = keepSingleCurrentStep(rawSteps);
  const currentStepId = currentStepForSection(input.activeSection, {
    hasInterviewStage: input.hasInterviewStage,
    nearestInterview: input.nearestInterview,
  });

  return stepsWithSequentialState.map((step) => ({
    ...step,
    reason: compactReason(step.reason),
    isCurrent: currentStepId !== null && step.id === currentStepId,
  }));
}


const SEQUENTIAL_STEPS: ReadonlySet<string> = new Set(['profile', 'role', 'shortlist']);

/**
 * Каждый шаг сейчас считается своим источником данных независимо от
 * остальных, и это может честно дать «в процессе» сразу двум шагам (например
 * «Роль» ещё активна в движке, а «Подборка» уже видит непустой пул). Кандидат
 * не может одновременно быть на двух шагах пути — только первый из них
 * остаётся «в процессе», следующие откатываются в «не начат» (приёмка B250).
 * «Отклики» и «Интервью» идут параллельно подбору и друг другу — в макете
 * B248 оба бывают активны сразу, поэтому правило их не трогает.
 */

function keepSingleCurrentStep(steps: readonly PathStep[]): readonly PathStep[] {
  let seenCurrent = false;
  return steps.map((step) => {
    if (step.state !== 'in-progress' || !SEQUENTIAL_STEPS.has(step.id)) return step;
    if (!seenCurrent) {
      seenCurrent = true;
      return step;
    }
    return { ...step, state: 'not-started' };
  });
}
