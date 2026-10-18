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
  readonly kind:
    'candidate_turn' | 'new_vacancy' | 'shortlist' | 'follow_up' | 'interview' | 'linkedin_post';
  /** Черновик поста LinkedIn, который ждёт одобрения. */
  readonly draftId?: string;
  /** Материал, который ждёт одобрения кандидата (черновик письма). */
  readonly material?: 'cover_letter';
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

export type MomentumMetricSource =
  'application_events.recorded_at' | 'candidate_interview_schedules.scheduled_at' | 'unavailable';

export interface MomentumMetricEvidence {
  readonly source: MomentumMetricSource;
  /** Number of source records included in this window's count. */
  readonly sampleSize: number;
  readonly unknownReason?: string;
}

export interface MomentumWindowEvidence {
  readonly startAt: string;
  readonly endAt: string;
  readonly applied: MomentumMetricEvidence;
  readonly views: MomentumMetricEvidence;
  readonly screenings: MomentumMetricEvidence;
  readonly interviews: MomentumMetricEvidence;
}

export interface SearchMomentum {
  readonly calculatedAt: string;
  readonly windows: {
    readonly '7d': MomentumMetrics;
    readonly '30d': MomentumMetrics;
  };
  readonly evidence: {
    readonly '7d': MomentumWindowEvidence;
    readonly '30d': MomentumWindowEvidence;
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
  readonly funnel: TodayFunnel;
}

/**
 * Этапы воронки «Сегодня», у которых есть проверяемый источник — стадия отклика:
 * избранное — сохранённые сейчас, ответы и офферы — переход в стадию за 30 дней.
 */
export interface TodayFunnel {
  readonly favorites: number;
  readonly responses: number;
  readonly offers: number;
}

const FUNNEL_WINDOW_MS = 30 * 86_400_000;
const ANSWERED_STAGES = new Set(['responded', 'interview', 'offer']);

export function computeTodayFunnel(
  applications: readonly ApplicationView[],
  now = new Date().toISOString(),
): TodayFunnel {
  const windowStart = Date.parse(now) - FUNNEL_WINDOW_MS;
  const inWindow = (application: ApplicationView) =>
    Date.parse(application.stageChangedAt) >= windowStart;
  return {
    favorites: applications.filter((application) => application.stage === 'saved').length,
    responses: applications.filter(
      (application) => ANSWERED_STAGES.has(application.stage) && inWindow(application),
    ).length,
    offers: applications.filter(
      (application) => application.stage === 'offer' && inWindow(application),
    ).length,
  };
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
  /** Черновики постов LinkedIn со статусом «черновик»: публикует только кандидат. */
  readonly pendingLinkedinPosts?: readonly TodayPendingPost[];
}

export interface TodayPendingPost {
  readonly id: string;
  readonly topic: string;
}

const MAX_FOLLOW_UPS = 5;
const MAX_FOLLOW_UP_CAPTIONS = 2;

function eyebrowFor(application: ApplicationView): string | null {
  if (application.followUp && ['due', 'overdue', 'stale'].includes(application.followUp.urgency)) {
    const days = application.followUp.daysSinceContact;
    return `ответа нет ${pluralRu(days, ['день', 'дня', 'дней'])}`;
  }
  // Дата интервью стоит в правой колонке строки; подпись её не повторяет.
  if (application.nearestInterview?.scheduledAt) return null;
  if (application.materials.coverLetter) return 'Черновик, ничего не отправлено';
  return null;
}

/** Порядок строк из откликов: просроченный ответ, затем интервью по дате, затем черновики. */
function queueRank(application: ApplicationView): number {
  const kind = queueKindFor(application);
  if (kind === 'follow_up') return application.followUp?.urgency === 'due' ? 1 : 0;
  return kind === 'interview' ? 2 : 3;
}

function byQueueUrgency(left: ApplicationView, right: ApplicationView): number {
  const rank = queueRank(left) - queueRank(right);
  if (rank !== 0) return rank;
  const leftAt = left.followUp?.dueAt ?? left.nearestInterview?.scheduledAt ?? '';
  const rightAt = right.followUp?.dueAt ?? right.nearestInterview?.scheduledAt ?? '';
  return leftAt.localeCompare(rightAt);
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

interface MomentumWindowResult {
  readonly metrics: MomentumMetrics;
  readonly evidence: MomentumWindowEvidence;
}

interface WindowActivityCount {
  readonly applied: number;
  readonly missingReceiptTimestamp: boolean;
  readonly interviews: number;
  readonly missingInterviewTimestamp: boolean;
}

function countWindowActivity(
  applications: readonly ApplicationView[],
  windowStartMs: number,
  windowEndMs: number,
): WindowActivityCount {
  let applied = 0;
  let missingReceiptTimestamp = false;
  let interviews = 0;
  let missingInterviewTimestamp = false;

  for (const app of applications) {
    if (deliveryState(app.stage, app.deliveryReceipt ?? null) === 'delivered') {
      const receiptMs = Date.parse(app.deliveryReceiptRecordedAt ?? '');
      if (Number.isNaN(receiptMs)) {
        missingReceiptTimestamp = true;
      } else if (receiptMs >= windowStartMs && receiptMs <= windowEndMs) {
        applied += 1;
      }
    }

    if (!app.interviewScheduledAt) {
      missingInterviewTimestamp = true;
      continue;
    }
    for (const scheduledAt of app.interviewScheduledAt) {
      const interviewMs = Date.parse(scheduledAt);
      if (Number.isNaN(interviewMs)) {
        missingInterviewTimestamp = true;
      } else if (interviewMs >= windowStartMs && interviewMs <= windowEndMs) {
        interviews += 1;
      }
    }
  }

  return { applied, missingReceiptTimestamp, interviews, missingInterviewTimestamp };
}

function calculateWindowMetrics(
  applications: readonly ApplicationView[],
  days: number,
  nowMs: number,
): MomentumWindowResult {
  const windowStartMs = nowMs - days * 86_400_000;
  const counts = countWindowActivity(applications, windowStartMs, nowMs);
  const metrics: MomentumMetrics = {
    applied: counts.missingReceiptTimestamp ? 'unknown' : counts.applied,
    views: 'unknown',
    screenings: 'unknown',
    interviews: counts.missingInterviewTimestamp ? 'unknown' : counts.interviews,
  };
  const evidence: MomentumWindowEvidence = {
    startAt: new Date(windowStartMs).toISOString(),
    endAt: new Date(nowMs).toISOString(),
    applied: {
      source: 'application_events.recorded_at',
      sampleSize: counts.applied,
      ...(counts.missingReceiptTimestamp ? { unknownReason: 'receipt_timestamp_unavailable' } : {}),
    },
    views: {
      source: 'unavailable',
      sampleSize: 0,
      unknownReason: 'candidate_view_events_are_not_recorded',
    },
    screenings: {
      source: 'unavailable',
      sampleSize: 0,
      unknownReason: 'candidate_response_events_are_not_recorded',
    },
    interviews: {
      source: 'candidate_interview_schedules.scheduled_at',
      sampleSize: counts.interviews,
      ...(counts.missingInterviewTimestamp
        ? { unknownReason: 'interview_timestamp_unavailable' }
        : {}),
    },
  };

  return { metrics, evidence };
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
    typeof metrics30d.metrics.applied === 'number' &&
    metrics30d.metrics.applied >= 30 &&
    metrics30d.metrics.interviews === 0;

  return {
    calculatedAt: now,
    windows: {
      '7d': metrics7d.metrics,
      '30d': metrics30d.metrics,
    },
    evidence: {
      '7d': metrics7d.evidence,
      '30d': metrics30d.evidence,
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
  // Очередь — только то, что ждёт ответа или имеет срок: избранная вакансия без материалов
  // в неё не идёт, а сохранённая с черновиком письма идёт как «одобрить письмо».
  const queueApplications = input.applications.filter((application) =>
    application.stage === 'saved'
      ? application.materials.coverLetter
      : application.whoseTurn === 'candidate',
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
    queue: buildQueue(
      queueApplications,
      input.newVacancies,
      shortlistToReview(input),
      input.pendingLinkedinPosts ?? [],
    ),
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
    funnel: computeTodayFunnel(input.applications, now),
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

function postQueueItem(post: TodayPendingPost): TodayQueueItem {
  return {
    kind: 'linkedin_post',
    draftId: post.id,
    title: post.topic,
    company: 'LinkedIn',
    eyebrow: 'сам не опубликуется',
    dueAt: null,
    fit: null,
  };
}

function buildQueue(
  waitingApplications: readonly ApplicationView[],
  newVacancies: BuildTodaySnapshotInput['newVacancies'],
  shortlist: readonly TodayNewVacancy[],
  pendingPosts: readonly TodayPendingPost[],
): TodayQueueItem[] {
  return [
    ...[...waitingApplications].sort(byQueueUrgency).map((application) => ({
      kind: queueKindFor(application),
      ...(queueKindFor(application) === 'candidate_turn' && application.materials.coverLetter
        ? { material: 'cover_letter' as const }
        : {}),
      applicationId: application.id,
      title: application.vacancy?.title ?? '',
      company: companyOf(application),
      eyebrow: eyebrowFor(application),
      dueAt: application.followUp?.dueAt ?? application.nearestInterview?.scheduledAt ?? null,
      fit: null,
    })),
    ...pendingPosts.map(postQueueItem),
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
  ];
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
