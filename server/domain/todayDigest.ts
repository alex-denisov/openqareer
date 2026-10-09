import type { ApplicationView } from './applicationDerivedFields';
import { deliveryState, isClosedApplicationStage } from '../../shared/applicationStage';
import { pluralRu } from '../../shared/pluralRu';
import type { VacancyLevelMatch, VacancyRoleMatch } from '../../shared/vacancyMatchOrder';

/** Структура зарплаты как в matched-vacancies — клиент форматирует сам. */
export interface TodaySalary {
  readonly from?: number;
  readonly to?: number;
  readonly currency?: string;
  readonly gross?: boolean;
}

/** Fit-точки новой вакансии (B248): роль/уровень из объяснения совпадения, гео пока нечем считать. */
export interface TodayFit {
  readonly role: VacancyRoleMatch;
  readonly level: VacancyLevelMatch;
  readonly geo: boolean | null;
}

/** Один элемент подбора, который нужен дайджесту дня — не весь `MatchedVacancyItem`. */
export interface TodayNewVacancy {
  readonly clusterId: string;
  readonly title: string;
  readonly company: string;
  readonly firstObservedAt: string;
  readonly lastSeenAt: string;
  readonly salary?: TodaySalary;
  readonly location?: string;
  readonly sourcesCount: number;
  readonly fit: TodayFit;
}

export interface TodayQueueItem {
  readonly kind: 'candidate_turn' | 'new_vacancy' | 'shortlist' | 'follow_up' | 'interview';
  readonly applicationId?: string;
  readonly clusterId?: string;
  readonly title: string;
  readonly company: string | null;
  /** Короткая причина строкой — «6 дней без ответа», «сегодня», «через 2 дня». `null` — нечего честно сказать. */
  readonly eyebrow: string | null;
  readonly dueAt: string | null;
  readonly salary?: TodaySalary;
  readonly location?: string;
  readonly fit: TodayFit | null;
}

export interface TodayNextInterview {
  readonly company: string | null;
  readonly title: string;
  readonly round: number;
  readonly at: string;
}

/** Подписи дайджеста, которые сам список чисел не несёт (макет B248 «Сегодня»). */
export interface TodayNewVacanciesCaption {
  readonly campaignRole: string | null;
  readonly sourcesCount: number;
  readonly updatedAt: string | null;
}

export interface TodayDigest {
  readonly waitingForYou: number;
  readonly newVacancies: number;
  readonly followUpsDueToday: number;
  readonly followUpsOverdue: number;
  readonly closedVacancies: number;
  readonly interviewsAhead: number;
  readonly nextInterview: TodayNextInterview | null;
  readonly newVacanciesCaption: TodayNewVacanciesCaption | null;
  /** До двух строк вида «Peraton — 6 дней тишины». */
  readonly followUpCaptions: readonly string[];
  /** Отклики, которые ждут ответа компании больше 7 дней (B255). */
  readonly applicationsWaitingOver7Days: number;
}

export type TodayFollowUpStatus = 'today' | 'overdue' | 'sent';

export interface TodayFollowUp {
  readonly applicationId: string;
  readonly company: string | null;
  readonly title: string;
  readonly status: TodayFollowUpStatus;
}

export interface TodaySinceLastVisit {
  readonly since: string | null;
  readonly items: readonly string[];
  readonly newVacanciesCount: number;
  readonly applicationsWaitingOver7Days: number;
  readonly nearestInterview: TodayNextInterview | null;
}

export type MomentumMetricValue = number | 'unknown';

export interface MomentumMetrics {
  readonly applied: MomentumMetricValue;
  readonly views: MomentumMetricValue;
  readonly screenings: MomentumMetricValue;
  readonly interviews: MomentumMetricValue;
}

export interface SearchMomentum {
  readonly calculatedAt: string;
  readonly windows: {
    readonly '7d': MomentumMetrics;
    readonly '30d': MomentumMetrics;
  };
  readonly burnoutNotice: boolean;
}

export interface TodaySnapshot {
  readonly digest: TodayDigest;
  readonly queue: TodayQueueItem[];
  readonly followUps: TodayFollowUp[];
  readonly sinceLastVisit: TodaySinceLastVisit;
  readonly vacanciesPending: boolean;
  readonly momentum: SearchMomentum;
}

export interface BuildTodaySnapshotInput {
  readonly applications: readonly ApplicationView[];
  /** `undefined` — холодный кэш подбора: подбор синхронно не считаем (B230, architecture.md §97). */
  readonly newVacancies: readonly TodayNewVacancy[] | undefined;
  readonly now?: string;
  readonly since: string | null;
  readonly closedVacanciesSinceVisit: number;
  /** Первая целевая роль кампании — подпись «новых вакансий», честно `null` без роли. */
  readonly campaignRole: string | null;
  /** Счётчики «с прошлого визита», собранные вызывающей стороной (architecture.md §57). */
  readonly companyEventsSinceVisit: number;
  /**
   * Вся подборка кампании в порядке совпадения (B266): неразобранные вакансии
   * без отклика добирают очередь дня, когда новых с прошлого визита нет.
   */
  readonly shortlist?: readonly TodayNewVacancy[];
}

const MAX_FOLLOW_UPS = 5;
/** Очередь дня — решения на сегодня, а не весь список (B266). */
const MAX_QUEUE_ITEMS = 5;
const MAX_FOLLOW_UP_CAPTIONS = 2;

function eyebrowFor(application: ApplicationView): string | null {
  if (application.followUp && ['due', 'overdue', 'stale'].includes(application.followUp.urgency)) {
    const days = application.followUp.daysSinceContact;
    return `${pluralRu(days, ['день', 'дня', 'дней'])} без ответа`;
  }
  if (application.nearestInterview?.scheduledAt) {
    const days = daysUntil(application.nearestInterview.scheduledAt);
    if (days !== null) return days <= 0 ? 'сегодня' : `через ${days} дня`;
  }
  return null;
}

function daysUntil(iso: string, now = new Date().toISOString()): number | null {
  const diffMs = new Date(iso).getTime() - new Date(now).getTime();
  if (Number.isNaN(diffMs)) return null;
  return Math.round(diffMs / 86_400_000);
}

function queueKindFor(application: ApplicationView): 'follow_up' | 'interview' | 'candidate_turn' {
  if (application.followUp && ['due', 'overdue', 'stale'].includes(application.followUp.urgency)) {
    return 'follow_up';
  }
  if (application.nearestInterview?.scheduledAt) return 'interview';
  return 'candidate_turn';
}

function companyOf(application: ApplicationView): string | null {
  if (!application.vacancy || application.vacancy.companyHidden) return null;
  return application.vacancy.company || null;
}

function followUpStatusFor(application: ApplicationView): TodayFollowUpStatus | null {
  if (application.followUp?.urgency === 'due') return 'today';
  if (application.followUp?.urgency === 'overdue' || application.followUp?.urgency === 'stale') {
    return 'overdue';
  }
  if (application.followUp?.urgency === 'sent') return 'sent';
  return null;
}

function newVacancyCaption(
  newVacancies: readonly TodayNewVacancy[] | undefined,
  campaignRole: string | null,
): TodayNewVacanciesCaption | null {
  if (!newVacancies || newVacancies.length === 0) return null;
  const sourcesCount = newVacancies.reduce(
    (max, vacancy) => Math.max(max, vacancy.sourcesCount),
    0,
  );
  const updatedAt = newVacancies.reduce<string | null>(
    (latest, vacancy) =>
      latest === null || vacancy.lastSeenAt > latest ? vacancy.lastSeenAt : latest,
    null,
  );
  return { campaignRole, sourcesCount, updatedAt };
}

function followUpCaptionsFor(applications: readonly ApplicationView[]): string[] {
  return applications
    .filter((application) => application.followUp?.urgency === 'due')
    .slice(0, MAX_FOLLOW_UP_CAPTIONS)
    .map((application) => {
      const company = companyOf(application) ?? application.vacancy?.title ?? 'Вакансия';
      const days = application.followUp?.daysSinceContact ?? 0;
      return `${company} — ${pluralRu(days, ['день', 'дня', 'дней'])} тишины`;
    });
}

/**
 * Количество откликов, которые ждут ответа компании больше 7 дней (B255).
 * Исключаются закрытые отклики (rejected, archived) и сохранённые без отправки (saved).
 */
export function countApplicationsWaitingOver7Days(
  applications: readonly ApplicationView[],
  now = new Date().toISOString(),
): number {
  return applications.filter((application) => {
    if (application.stage !== 'applied' && application.stage !== 'responded') {
      return false;
    }
    if (application.followUp && typeof application.followUp.daysSinceContact === 'number') {
      return application.followUp.daysSinceContact > 7;
    }
    const dateStr = application.stageChangedAt;
    if (!dateStr) return false;
    const diffMs = Date.parse(now) - Date.parse(dateStr);
    return !Number.isNaN(diffMs) && diffMs > 7 * 86_400_000;
  }).length;
}

function calculateWindowMetrics(
  applications: readonly ApplicationView[],
  days: number,
  nowMs: number,
): MomentumMetrics {
  const windowStartMs = nowMs - days * 86_400_000;
  let appliedCount = 0;
  let interviewsCount = 0;

  for (const app of applications) {
    const eventTimeStr = app.stageChangedAt || app.createdAt;
    const eventTimeMs = Date.parse(eventTimeStr);
    const inWindow =
      !Number.isNaN(eventTimeMs) && eventTimeMs >= windowStartMs && eventTimeMs <= nowMs;

    if (inWindow && deliveryState(app.stage, app.deliveryReceipt ?? null) === 'delivered') {
      appliedCount += 1;
    }

    if (!isClosedApplicationStage(app.stage)) {
      if (app.nearestInterview?.scheduledAt) {
        const intMs = Date.parse(app.nearestInterview.scheduledAt);
        if (!Number.isNaN(intMs) && intMs >= windowStartMs && intMs <= nowMs) {
          interviewsCount += 1;
        }
      } else if (app.stage === 'interview' && inWindow) {
        interviewsCount += 1;
      }
    }
  }

  return {
    applied: appliedCount,
    views: 'unknown',
    screenings: 'unknown',
    interviews: interviewsCount,
  };
}

/**
 * Импульс поиска (B397): честные метрики за окна 7 и 30 дней и мягкая защита от выгорания.
 */
export function computeSearchMomentum(
  candidateIdOrApplications: string | readonly ApplicationView[],
  nowOrCandidateId?: string,
  maybeApplications?: readonly ApplicationView[],
): SearchMomentum {
  let applications: readonly ApplicationView[] = [];
  let now = new Date().toISOString();

  if (Array.isArray(candidateIdOrApplications)) {
    applications = candidateIdOrApplications;
    if (typeof nowOrCandidateId === 'string') now = nowOrCandidateId;
  } else if (typeof candidateIdOrApplications === 'string') {
    if (typeof nowOrCandidateId === 'string' && !Array.isArray(maybeApplications)) {
      now = nowOrCandidateId;
    }
    if (Array.isArray(maybeApplications)) {
      applications = maybeApplications;
    }
  }

  const nowMs = Date.parse(now);
  const metrics7d = calculateWindowMetrics(applications, 7, nowMs);
  const metrics30d = calculateWindowMetrics(applications, 30, nowMs);

  const burnoutNotice =
    typeof metrics30d.applied === 'number' &&
    metrics30d.applied >= 30 &&
    metrics30d.interviews === 0;

  return {
    calculatedAt: now,
    windows: {
      '7d': metrics7d,
      '30d': metrics30d,
    },
    burnoutNotice,
  };
}

/**
 * Сборщик «Сегодня» (B251, S4/S4b, architecture.md §57): чистая функция, весь
 * ввод-вывод — на вызывающей стороне маршрута.
 */
export function buildTodaySnapshot(input: BuildTodaySnapshotInput): TodaySnapshot {
  const now = input.now ?? new Date().toISOString();
  const waitingApplications = input.applications.filter(
    (application) => application.whoseTurn === 'candidate',
  );
  const upcomingInterviews = upcomingInterviewsOf(input.applications);
  const applicationsWaitingOver7Days = countApplicationsWaitingOver7Days(input.applications, now);
  const nearestInterview = nextInterviewOf(upcomingInterviews[0]);
  return {
    digest: {
      waitingForYou: waitingApplications.length,
      newVacancies: input.newVacancies?.length ?? 0,
      followUpsDueToday: input.applications.filter(
        (application) => application.followUp?.urgency === 'due',
      ).length,
      followUpsOverdue: input.applications.filter(
        (application) =>
          application.followUp?.urgency === 'overdue' || application.followUp?.urgency === 'stale',
      ).length,
      closedVacancies: input.closedVacanciesSinceVisit,
      interviewsAhead: upcomingInterviews.length,
      nextInterview: nearestInterview,
      newVacanciesCaption: newVacancyCaption(input.newVacancies, input.campaignRole),
      followUpCaptions: followUpCaptionsFor(input.applications),
      applicationsWaitingOver7Days,
    },
    queue: buildQueue(waitingApplications, input.newVacancies, shortlistToReview(input)),
    followUps: buildFollowUps(input.applications),
    sinceLastVisit: {
      since: input.since,
      items: sinceLastVisitItemsOf(input),
      newVacanciesCount: input.newVacancies?.length ?? 0,
      applicationsWaitingOver7Days,
      nearestInterview,
    },
    vacanciesPending: input.newVacancies === undefined,
    momentum: computeSearchMomentum(input.applications, now),
  };
}

/** Лучшие по совпадению вакансии подборки, по которым ещё нет ни отклика, ни «новой». */
function shortlistToReview(input: BuildTodaySnapshotInput): readonly TodayNewVacancy[] {
  const taken = new Set<string>([
    ...input.applications.flatMap((application) =>
      application.clusterId ? [application.clusterId] : [],
    ),
    ...(input.newVacancies ?? []).map((vacancy) => vacancy.clusterId),
  ]);
  return (input.shortlist ?? []).filter((vacancy) => !taken.has(vacancy.clusterId));
}

function buildQueue(
  waitingApplications: readonly ApplicationView[],
  newVacancies: BuildTodaySnapshotInput['newVacancies'],
  shortlist: readonly TodayNewVacancy[],
): TodayQueueItem[] {
  return [
    ...waitingApplications.map((application) => ({
      kind: queueKindFor(application),
      applicationId: application.id,
      title: application.vacancy?.title ?? '',
      company: companyOf(application),
      eyebrow: eyebrowFor(application),
      dueAt: application.followUp?.dueAt ?? application.nearestInterview?.scheduledAt ?? null,
      fit: null,
    })),
    ...(newVacancies ?? []).map((vacancy) => ({
      kind: 'new_vacancy' as const,
      clusterId: vacancy.clusterId,
      title: vacancy.title,
      company: vacancy.company,
      eyebrow: 'сегодня',
      dueAt: null,
      salary: vacancy.salary,
      location: vacancy.location,
      fit: vacancy.fit,
    })),
    ...shortlist.map((vacancy) => ({
      kind: 'shortlist' as const,
      clusterId: vacancy.clusterId,
      title: vacancy.title,
      company: vacancy.company,
      eyebrow: 'в подборке, не разобрана',
      dueAt: null,
      salary: vacancy.salary,
      location: vacancy.location,
      fit: vacancy.fit,
    })),
  ].slice(0, Math.max(MAX_QUEUE_ITEMS, waitingApplications.length));
}

function upcomingInterviewsOf(applications: readonly ApplicationView[]): ApplicationView[] {
  return applications
    .filter(
      (application) =>
        application.nearestInterview?.scheduledAt && !isClosedApplicationStage(application.stage),
    )
    .sort((a, b) =>
      (a.nearestInterview?.scheduledAt as string).localeCompare(
        b.nearestInterview?.scheduledAt as string,
      ),
    );
}

function nextInterviewOf(application: ApplicationView | undefined): TodayNextInterview | null {
  if (!application) return null;
  return {
    company: companyOf(application),
    title: application.vacancy?.title ?? '',
    round: application.nearestInterview?.round ?? 1,
    at: application.nearestInterview?.scheduledAt as string,
  };
}

function buildFollowUps(applications: readonly ApplicationView[]): TodayFollowUp[] {
  return applications
    .map((application) => ({ application, status: followUpStatusFor(application) }))
    .filter(
      (entry): entry is { application: ApplicationView; status: TodayFollowUpStatus } =>
        entry.status !== null,
    )
    .slice(0, MAX_FOLLOW_UPS)
    .map(({ application, status }) => ({
      applicationId: application.id,
      company: companyOf(application),
      title: application.vacancy?.title ?? '',
      status,
    }));
}

function sinceLastVisitItemsOf(input: BuildTodaySnapshotInput): string[] {
  const items: string[] = [];
  const freshCount = input.newVacancies?.length ?? 0;
  if (freshCount > 0) {
    const fresh = pluralRu(freshCount, ['новая вакансия', 'новые вакансии', 'новых вакансий']);
    items.push(input.campaignRole ? `${fresh} по роли ${input.campaignRole}` : fresh);
  }
  if (input.closedVacanciesSinceVisit > 0) {
    items.push(
      `${pluralRu(input.closedVacanciesSinceVisit, ['вакансия закрылась', 'вакансии закрылись', 'вакансий закрылись'])} без ответа`,
    );
  }
  if (input.companyEventsSinceVisit > 0) {
    items.push(
      pluralRu(input.companyEventsSinceVisit, [
        'событие от компаний',
        'события от компаний',
        'событий от компаний',
      ]),
    );
  }
  return items;
}
