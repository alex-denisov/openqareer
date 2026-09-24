import type { ApplicationView } from './applicationDerivedFields';
import { pluralRu } from '../../shared/pluralRu';
import type { VacancyRoleMatch } from '../../shared/vacancyMatchOrder';

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
  readonly level: VacancyRoleMatch | null;
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
  readonly kind: 'candidate_turn' | 'new_vacancy' | 'follow_up' | 'interview';
  readonly applicationId?: string;
  readonly clusterId?: string;
  readonly title: string;
  readonly company: string | null;
  /** Короткая причина строкой — «6 рабочих дней без ответа», «сегодня», «через 2 дня». `null` — нечего честно сказать. */
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
  readonly closedVacancies: number;
  readonly interviewsAhead: number;
  readonly nextInterview: TodayNextInterview | null;
  readonly newVacanciesCaption: TodayNewVacanciesCaption | null;
  /** До двух строк вида «Peraton — 6 рабочих дней тишины». */
  readonly followUpCaptions: readonly string[];
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
}

export interface TodaySnapshot {
  readonly digest: TodayDigest;
  readonly queue: TodayQueueItem[];
  readonly followUps: TodayFollowUp[];
  readonly sinceLastVisit: TodaySinceLastVisit;
  readonly vacanciesPending: boolean;
}

export interface BuildTodaySnapshotInput {
  readonly applications: readonly ApplicationView[];
  /** `undefined` — холодный кэш подбора: подбор синхронно не считаем (B230, architecture.md §97). */
  readonly newVacancies: readonly TodayNewVacancy[] | undefined;
  readonly since: string | null;
  readonly closedVacanciesSinceVisit: number;
  /** Первая целевая роль кампании — подпись «новых вакансий», честно `null` без роли. */
  readonly campaignRole: string | null;
  /** Счётчики «с прошлого визита», собранные вызывающей стороной (architecture.md §57). */
  readonly companyEventsSinceVisit: number;
}

const MAX_FOLLOW_UPS = 5;
const MAX_FOLLOW_UP_CAPTIONS = 2;

function eyebrowFor(application: ApplicationView): string | null {
  if (application.followUp && (application.followUp.urgency === 'due' || application.followUp.urgency === 'stale')) {
    return `${application.followUp.businessDaysSinceContact} рабочих дней без ответа`;
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
  if (application.followUp && (application.followUp.urgency === 'due' || application.followUp.urgency === 'stale')) {
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
  if (application.followUp?.urgency === 'stale') return 'overdue';
  if (application.followUp?.urgency === 'due') return 'today';
  return null;
}

function newVacancyCaption(
  newVacancies: readonly TodayNewVacancy[] | undefined,
  campaignRole: string | null,
): TodayNewVacanciesCaption | null {
  if (!newVacancies || newVacancies.length === 0) return null;
  const sourcesCount = newVacancies.reduce((max, vacancy) => Math.max(max, vacancy.sourcesCount), 0);
  const updatedAt = newVacancies.reduce<string | null>(
    (latest, vacancy) => (latest === null || vacancy.lastSeenAt > latest ? vacancy.lastSeenAt : latest),
    null,
  );
  return { campaignRole, sourcesCount, updatedAt };
}

function followUpCaptionsFor(applications: readonly ApplicationView[]): string[] {
  return applications
    .filter(
      (application) =>
        application.followUp && (application.followUp.urgency === 'due' || application.followUp.urgency === 'stale'),
    )
    .slice(0, MAX_FOLLOW_UP_CAPTIONS)
    .map((application) => {
      const company = companyOf(application) ?? application.vacancy?.title ?? 'Вакансия';
      const days = application.followUp?.businessDaysSinceContact ?? 0;
      return `${company} — ${days} рабочих дней тишины`;
    });
}

/**
 * Сборщик «Сегодня» (B251, S4/S4b, architecture.md §57): чистая функция, весь
 * ввод-вывод — на вызывающей стороне маршрута.
 */
export function buildTodaySnapshot(input: BuildTodaySnapshotInput): TodaySnapshot {
  const waitingApplications = input.applications.filter(
    (application) => application.whoseTurn === 'candidate',
  );
  const upcomingInterviews = upcomingInterviewsOf(input.applications);
  return {
    digest: {
      waitingForYou: waitingApplications.length,
      newVacancies: input.newVacancies?.length ?? 0,
      closedVacancies: input.closedVacanciesSinceVisit,
      interviewsAhead: upcomingInterviews.length,
      nextInterview: nextInterviewOf(upcomingInterviews[0]),
      newVacanciesCaption: newVacancyCaption(input.newVacancies, input.campaignRole),
      followUpCaptions: followUpCaptionsFor(input.applications),
    },
    queue: buildQueue(waitingApplications, input.newVacancies),
    followUps: buildFollowUps(input.applications),
    sinceLastVisit: { since: input.since, items: sinceLastVisitItemsOf(input) },
    vacanciesPending: input.newVacancies === undefined,
  };
}

function buildQueue(
  waitingApplications: readonly ApplicationView[],
  newVacancies: BuildTodaySnapshotInput['newVacancies'],
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
  ];
}

function upcomingInterviewsOf(applications: readonly ApplicationView[]): ApplicationView[] {
  return applications
    .filter((application) => application.nearestInterview?.scheduledAt)
    .sort((a, b) =>
      (a.nearestInterview?.scheduledAt as string).localeCompare(b.nearestInterview?.scheduledAt as string),
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
    .filter((entry): entry is { application: ApplicationView; status: TodayFollowUpStatus } => entry.status !== null)
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
      pluralRu(input.companyEventsSinceVisit, ['событие от компаний', 'события от компаний', 'событий от компаний']),
    );
  }
  return items;
}
