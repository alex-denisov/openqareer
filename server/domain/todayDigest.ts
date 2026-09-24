import type { ApplicationView } from './applicationDerivedFields';

/** Один элемент подбора, который нужен дайджесту дня — не весь `MatchedVacancyItem`. */
export interface TodayNewVacancy {
  readonly clusterId: string;
  readonly title: string;
  readonly company: string;
  readonly firstObservedAt: string;
}

export interface TodayQueueItem {
  readonly kind: 'candidate_turn' | 'new_vacancy';
  readonly applicationId?: string;
  readonly clusterId?: string;
  readonly title: string;
  readonly dueAt: string | null;
}

export interface TodayDigest {
  readonly waitingForYou: number;
  readonly newVacancies: number;
  readonly closedVacancies: number;
}

export interface TodaySnapshot {
  readonly digest: TodayDigest;
  readonly queue: TodayQueueItem[];
  readonly sinceLastVisit: string | null;
  readonly vacanciesPending: boolean;
}

export interface BuildTodaySnapshotInput {
  readonly applications: readonly ApplicationView[];
  /** `undefined` — холодный кэш подбора: подбор синхронно не считаем (B230, architecture.md §97). */
  readonly newVacancies: readonly TodayNewVacancy[] | undefined;
  readonly sinceLastVisit: string | null;
  readonly closedVacanciesSinceVisit: number;
}

/**
 * Сборщик «Сегодня» (B251, S4, architecture.md §57): чистая функция, весь
 * ввод-вывод — на вызывающей стороне маршрута.
 */
export function buildTodaySnapshot(input: BuildTodaySnapshotInput): TodaySnapshot {
  const waitingApplications = input.applications.filter(
    (application) => application.whoseTurn === 'candidate',
  );

  const queue: TodayQueueItem[] = [
    ...waitingApplications.map((application) => ({
      kind: 'candidate_turn' as const,
      applicationId: application.id,
      title: application.vacancy?.title ?? '',
      dueAt: application.followUp?.dueAt ?? null,
    })),
    ...(input.newVacancies ?? []).map((vacancy) => ({
      kind: 'new_vacancy' as const,
      clusterId: vacancy.clusterId,
      title: vacancy.title,
      dueAt: null,
    })),
  ];

  return {
    digest: {
      waitingForYou: waitingApplications.length,
      newVacancies: input.newVacancies?.length ?? 0,
      closedVacancies: input.closedVacanciesSinceVisit,
    },
    queue,
    sinceLastVisit: input.sinceLastVisit,
    vacanciesPending: input.newVacancies === undefined,
  };
}
