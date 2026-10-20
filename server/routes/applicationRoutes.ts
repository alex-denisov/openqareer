import { currentTodayDecision, isTodayActionDeferred } from '../../shared/todayDecision';
import { buildTodayTeamSizeDecision } from '../domain/todayTeamSizeDecision';
import { registerTodayDecisionRoutes } from './todayDecisionRoutes';
import { registerTodayChangesRoutes } from './todayChangesRoutes';
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { APPLICATION_STAGES } from '../../shared/applicationStage';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, withDeps } from './helpers';
import { isoDateField } from './isoDateField';
import { registerApplicationMaterialsRoutes } from './applicationMaterialsRoutes';
import { registerApplicationInterviewRoutes } from './applicationInterviewRoutes';
import { registerApplicationOfferRoutes } from './applicationOfferRoutes';
import { registerDecisionProfileRoutes } from './decisionProfileRoutes';
import { registerRelocationQuestionnaireRoutes } from './relocationQuestionnaireRoutes';
import { registerCareerVectorRoutes } from './careerVectorRoutes';
import { registerCareerDiaryRoutes } from './careerDiaryRoutes';
import { registerReferralTrackRoutes } from './referralTrackRoutes';
import { registerStarPrepRoutes } from './starPrepRoutes';
import { registerStarStoryRoutes } from './starStoryRoutes';
import { registerInterviewSimulatorRoutes } from './interviewSimulatorRoutes';
import { registerVacancySkipRoutes } from './vacancySkipRoutes';
import { registerCandidateAutomationRoutes } from './candidateAutomationRoutes';
import {
  notificationRepositoryFor,
  recordNotificationFromSource,
} from './notificationRepositoryAccess';
import { readCampaign } from './campaignContext';
import { readMatchProfile, readMatchedSnapshot } from '../vacancies/matchedPoolContext';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { readTargetLevel } from './vacancyRoleContext';
import { buildTodaySnapshot, type TodayNewVacancy } from '../domain/todayDigest';
import { addStoredVacancyLevels } from '../vacancies/storedVacancyLevels';
import { registerApplicationOperationsRoutes } from './applicationOperationsRoutes';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const stageSchema = z.enum(APPLICATION_STAGES);

const vacancySnapshotSchema = z.object({
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().max(300).default(''),
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((value) => /^https?:\/\//iu.test(value), 'url_scheme_not_allowed'),
  source: z.string().trim().max(120).default(''),
});

/**
 * A card with no vacancy in the pool ("через рекрутера, компания скрыта",
 * owner decision 2026-09-23 22:26): no `url` required, `company` may be
 * empty and explicitly marked hidden rather than missing.
 */
const manualVacancySchema = z.object({
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().max(300).default(''),
  companyHidden: z.boolean().default(false),
  source: z.enum(['recruiter', 'other']),
  url: z
    .string()
    .trim()
    .url()
    .max(2000)
    .refine((value) => /^https?:\/\//iu.test(value), 'url_scheme_not_allowed')
    .optional(),
});

/**
 * `POST /applications` (B251, S1–S2, architecture.md §4). `clusterId` покрывает
 * карточку из подбора; ручная карточка «через рекрутера» посылает
 * `manualVacancy` без `clusterId`.
 */
const createApplicationSchema = z
  .object({
    clusterId: z.string().trim().min(1).max(200).optional(),
    // Either the pool's own snapshot (url required, attached alongside
    // `clusterId`) or a card with no vacancy in the pool at all.
    manualVacancy: z.union([vacancySnapshotSchema, manualVacancySchema]).optional(),
    stage: stageSchema,
    occurredAt: isoDateField.optional(),
  })
  .refine((body) => Boolean(body.clusterId) || Boolean(body.manualVacancy), {
    message: 'clusterId_or_manualVacancy_required',
  });

function normalizeVacancySnapshot(
  input: z.infer<typeof vacancySnapshotSchema> | z.infer<typeof manualVacancySchema>,
): import('../../shared/vacancyApplication').VacancyApplicationSnapshot {
  return {
    title: input.title,
    company: input.company,
    url: input.url ?? '',
    source: input.source,
    ...('companyHidden' in input ? { companyHidden: input.companyHidden } : {}),
  };
}

const deliveryReceiptSchema = z
  .object({
    kind: z.enum(['confirmation_url', 'auto_reply', 'screenshot', 'failure_note']),
    value: z.string().trim().min(1).max(2000),
  })
  .superRefine((receipt, context) => {
    if (receipt.kind !== 'confirmation_url') return;
    try {
      if (new URL(receipt.value).protocol !== 'https:') throw new Error('unsafe_scheme');
    } catch {
      context.addIssue({ code: 'custom', message: 'receipt_url_must_be_https', path: ['value'] });
    }
  });

const patchApplicationSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  stage: stageSchema.optional(),
  occurredAt: isoDateField.optional(),
  notes: z.string().max(20_000).nullable().optional(),
  processProfile: z.enum(['standard', 'executive']).optional(),
  followUpDueAt: isoDateField.nullable().optional(),
  deliveryReceipt: deliveryReceiptSchema.nullable().optional(),
});

const restoreApplicationSchema = z.object({ expectedVersion: z.number().int().nonnegative() });

const handleCreateApplication: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = createApplicationSchema.parse(request.body);
  const created = candidateStore.createApplication(candidate.id, {
    clusterId: body.clusterId ?? null,
    manualVacancy: body.manualVacancy ? normalizeVacancySnapshot(body.manualVacancy) : undefined,
    stage: body.stage,
    occurredAt: body.occurredAt,
  });
  return { data: created, meta: { requestId: request.id } };
};

const handlePatchApplication: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const applicationId = (request.params as { id: string }).id;
  const body = patchApplicationSchema.parse(request.body);
  const current = candidateStore.getApplication(candidate.id, applicationId);
  const patched = candidateStore.patchApplication(
    candidate.id,
    applicationId,
    body,
    config.applicationArchiveStaleDays,
  );
  recordApplicationNotifications(
    deps,
    request,
    candidate.id,
    applicationId,
    current?.stage ?? null,
    patched,
    body,
  );
  return { data: patched, meta: { requestId: request.id } };
};

function recordApplicationNotifications(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  applicationId: string,
  previousStage: string | null,
  updated: { readonly stage: string; readonly version: number },
  input: z.infer<typeof patchApplicationSchema>,
): void {
  const createdAt = input.occurredAt ?? new Date().toISOString();
  if (
    previousStage !== updated.stage &&
    ['responded', 'interview', 'offer'].includes(updated.stage)
  ) {
    recordNotificationFromSource(deps, request, candidateId, {
      kind: 'employer_reply',
      sourceType: 'application',
      sourceId: applicationId,
      idempotencyKey: `employer-reply:${applicationId}:${updated.version}`,
      createdAt,
    });
  }
  if (input.deliveryReceipt?.kind === 'failure_note') {
    recordNotificationFromSource(deps, request, candidateId, {
      kind: 'delivery_error',
      sourceType: 'application',
      sourceId: applicationId,
      idempotencyKey: `delivery-error:${applicationId}:${updated.version}`,
      createdAt,
    });
  }
}

const handleRestoreApplication: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const applicationId = (request.params as { id: string }).id;
  const body = restoreApplicationSchema.parse(request.body);
  const restored = candidateStore.restoreApplication(
    candidate.id,
    applicationId,
    body.expectedVersion,
    config.applicationArchiveStaleDays,
  );
  return { data: restored, meta: { requestId: request.id } };
};

const recordEventSchema = z.object({
  kind: z.enum(['follow_up_sent', 'thank_you_sent', 'promise']),
  occurredAt: isoDateField,
  note: z.string().max(4_000).nullable().optional(),
});

const handleRecordApplicationEvent: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const applicationId = (request.params as { id: string }).id;
  const body = recordEventSchema.parse(request.body);
  const updated = candidateStore.recordApplicationEvent(candidate.id, applicationId, body);
  return { data: updated, meta: { requestId: request.id } };
};

const handleApplicationFunnel: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  return { data: candidateStore.applicationFunnel(candidate.id), meta: { requestId: request.id } };
};

/** `POST /visits` (architecture.md §4, §57): отметка визита с дебаунсом 30 минут. */
const handleRecordVisit: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const result = candidateStore.recordCandidateVisit(candidate.id, new Date().toISOString());
  return { data: { since: result.since }, meta: { requestId: request.id } };
};

/**
 * IANA timezone name, not the numeric offset the older `/applications` reads
 * use: `/today` will need calendar-day math later (architecture.md §57), and
 * an offset alone cannot say whether a given instant crossed midnight under
 * DST. Validated by asking `Intl` to accept it — an invalid zone throws.
 */
const ianaTimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'invalid_timezone');

const todayQuerySchema = z
  .object({
    tz: ianaTimezoneSchema,
    queueOffset: z.coerce.number().int().min(5).max(10_000).optional(),
    queueRevision: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .optional(),
  })
  .refine(
    (query) => (query.queueOffset === undefined) === (query.queueRevision === undefined),
    'queue_pagination_requires_offset_and_revision',
  );

/**
 * Тот же отпечаток снимка, что и у самого подбора (уровень включительно), но
 * читается асинхронно (`readMatchedSnapshot`), не `peek`: очередь дня не
 * должна зависеть от того, заходил ли кандидат в «Вакансии» за последние 90
 * с (C55). Кандидат без роли/навыков подбирать физически нечем — матчинг не
 * запускается, `matched` — пустой список, а не «неизвестно».
 */
async function readTodayMatchedVacancies(
  deps: Pick<RouteDeps, 'candidateStore' | 'multiSourceEngine'>,
  candidateId: string,
): Promise<{
  matched: MatchedVacancyItem[];
  targetRoles: readonly string[];
  targetLevel: ReturnType<typeof readTargetLevel>;
}> {
  const { candidateStore, multiSourceEngine } = deps;
  const { confirmedSkills } = readMatchProfile(candidateStore, candidateId);
  const campaign = readCampaign(candidateStore, candidateId);
  const targetRoles = [...campaign.roles.value];
  const targetLevel = readTargetLevel(candidateStore, candidateId, targetRoles);
  const matched =
    confirmedSkills.length === 0 && targetRoles.length === 0
      ? []
      : await readMatchedSnapshot(
          multiSourceEngine,
          candidateId,
          confirmedSkills,
          targetRoles,
          targetLevel,
        );
  return {
    matched: matched.filter((item) => !campaign.remoteOnly || item.cluster.isRemote),
    targetRoles,
    targetLevel,
  };
}

function todayNewVacancies(
  matched: readonly MatchedVacancyItem[] | undefined,
  targetLevel: ReturnType<typeof readTargetLevel>,
  titleParseStore: RouteDeps['titleParseStore'],
): TodayNewVacancy[] | undefined {
  return matched
    ? addStoredVacancyLevels(matched, targetLevel, (key) => titleParseStore.getByKey(key)).map(
        (item) => ({
          clusterId: item.cluster.id,
          title: item.cluster.canonicalTitle,
          company: item.cluster.canonicalCompany,
          firstObservedAt: item.cluster.firstObservedAt,
          lastSeenAt: item.cluster.lastSeenAt,
          salary: item.cluster.salary,
          location: item.cluster.canonicalLocation,
          sourcesCount: new Set(item.cluster.sources.map((source) => source.sourceId)).size,
          fit: {
            role: item.explanation.roleMatch,
            level: item.explanation.levelMatch ?? 'unknown',
            geo: null,
          },
        }),
      )
    : undefined;
}

function recordFreshVacancyNotification(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  vacancies: readonly TodayNewVacancy[],
): void {
  if (!vacancies.length) return;
  const sourceId = createHash('sha256')
    .update(
      vacancies
        .map((vacancy) => vacancy.clusterId)
        .sort()
        .join('\0'),
    )
    .digest('hex');
  recordNotificationFromSource(deps, request, candidateId, {
    kind: 'new_vacancies_by_role',
    sourceType: 'matched_vacancy_batch',
    sourceId,
    idempotencyKey: `new-vacancies:${sourceId}`,
  });
}

const TODAY_QUEUE_INITIAL_COUNT = 5;

/** Посты LinkedIn в статусе черновика: кандидат одобряет и публикует сам. */
function pendingLinkedinPosts(deps: RouteDeps, candidateId: string) {
  return (deps.candidateDraftRepository?.listRecent(candidateId, 20) ?? [])
    .filter((draft) => draft.kind === 'post' && draft.status === 'draft')
    .map((draft) => ({ id: draft.id, topic: draft.topic }));
}

async function readTodaySnapshot(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  now: Date,
) {
  const { candidateStore, titleParseStore } = deps;
  const since = candidateStore.getSinceLastVisit(candidateId);
  const applications = candidateStore.listApplications(candidateId);
  const { matched, targetRoles, targetLevel } = await readTodayMatchedVacancies(deps, candidateId);
  const newVacancies = todayNewVacancies(matched, targetLevel, titleParseStore) ?? [];
  const freshNewVacancies = newVacancies.filter(
    (vacancy) => vacancy.fit.role !== 'none' && (since === null || vacancy.firstObservedAt > since),
  );
  const snapshot = buildTodaySnapshot({
    applications,
    newVacancies: freshNewVacancies,
    since,
    closedVacanciesSinceVisit:
      since === null ? 0 : candidateStore.countSystemClosuresSince(candidateId, since),
    campaignRole: targetRoles[0] ?? null,
    companyEventsSinceVisit:
      since === null ? 0 : candidateStore.countCompanyEventsSince(candidateId, since),
    shortlist: newVacancies,
    pendingLinkedinPosts: pendingLinkedinPosts(deps, candidateId),
    contacts: candidateStore.listApplicationContacts?.(candidateId),
    changeEvents:
      since === null
        ? []
        : notificationRepositoryFor(deps).listCompanyEventsSince(
            candidateId,
            since,
            now.toISOString(),
          ),
    changesDismissedAt: candidateStore.getCandidateWorkspace(candidateId)?.todayChangesDismissedAt,
    now: now.toISOString(),
  });
  recordFreshVacancyNotification(deps, request, candidateId, freshNewVacancies);
  return {
    snapshot: {
      ...snapshot,
      teamSizeDecision: todayTeamSizeDecision(deps, candidateId, applications, matched, now),
    },
    workspace: candidateStore.getCandidateWorkspace(candidateId),
  };
}

/** Favorites' text is what the pool knows of the vacancy plus the candidate's own notes. */
function todayTeamSizeDecision(
  deps: RouteDeps,
  candidateId: string,
  applications: ReturnType<RouteDeps['candidateStore']['listApplications']>,
  matched: readonly MatchedVacancyItem[],
  now: Date,
) {
  const experience = deps.candidateStore.getSnapshot(candidateId).resume?.draft.experience ?? [];
  if (!experience.some((entry) => entry.current && !entry.teamSize)) return undefined;
  const summaries = new Map(
    matched.map((item) => [item.cluster.id, item.cluster.descriptionSummary]),
  );
  const favorites = applications
    .filter((application) => application.stage === 'saved')
    .map((application) => ({
      text: [summaries.get(application.clusterId ?? ''), application.notes]
        .filter(Boolean)
        .join('\n'),
    }));
  return buildTodayTeamSizeDecision({ experience, favorites, now: now.toISOString() }) ?? undefined;
}

function todayQueuePage(
  queue: ReturnType<typeof buildTodaySnapshot>['queue'],
  offset: number | undefined,
  requestedRevision: string | undefined,
) {
  const revision = createHash('sha256').update(JSON.stringify(queue)).digest('hex');
  if (offset !== undefined && requestedRevision !== revision) return null;
  return {
    queue: offset === undefined ? queue.slice(0, TODAY_QUEUE_INITIAL_COUNT) : queue.slice(offset),
    queueTotal: queue.length,
    queueRevision: revision,
    queueOffset: offset ?? 0,
  };
}

/**
 * `GET /today` (architecture.md §4, §57, §97; C55): дайджест дня. Подбор
 * читается тем же асинхронным путём, что и «Вакансии» (`readMatchedSnapshot`)
 * — очередь дня не зависит от того, заходил ли кандидат в «Вакансии» за
 * последние 90 с. Снимок общий на процесс (`matchedPoolContext.ts`), так что
 * повторное чтение в пределах TTL ничего не пересчитывает (B230 остаётся в
 * силе — считаем один раз на снимок, а не на каждый запрос).
 */
const handleToday: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const {
    tz,
    queueOffset,
    queueRevision: requestedRevision,
  } = todayQuerySchema.parse(request.query ?? {});
  const now = new Date();
  const { snapshot, workspace } = await readTodaySnapshot(deps, request, candidate.id, now);
  const selection = currentTodayDecision(workspace?.todayDecisionSelection, now, tz);
  const todayDecisionSelection = snapshot.queue.some(
    (item) => item.applicationId === selection?.applicationId && item.kind === 'follow_up',
  )
    ? selection
    : undefined;
  const todayActionDeferral = isTodayActionDeferred(workspace?.todayActionDeferral, now, tz)
    ? workspace?.todayActionDeferral
    : undefined;
  const queuePage = todayQueuePage(snapshot.queue, queueOffset, requestedRevision);
  if (!queuePage) {
    return reply.code(409).send({
      error: {
        code: 'today_queue_changed',
        message: 'Очередь изменилась. Обновите экран и попробуйте ещё раз.',
      },
    });
  }
  // B534: «Сегодня» знает, какие площадки подключены, без отдельного запроса каталога.
  const connectedSources = [
    ...new Set(
      candidateStore.listNativeSourceConnections(candidate.id).map((item) => item.platform),
    ),
  ];
  return {
    data: {
      ...snapshot,
      ...queuePage,
      todayDecisionSelection,
      todayActionDeferral,
      connectedSources,
    },
    meta: { requestId: request.id },
  };
};

/** Трекер откликов (B251, S1–S2, architecture.md §4). */
export function registerApplicationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  registerApplicationOperationsRoutes(app, deps);
  app.post(
    '/api/v1/candidate/applications',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, handleCreateApplication),
  );
  app.patch(
    '/api/v1/candidate/applications/:id',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handlePatchApplication),
  );
  app.post(
    '/api/v1/candidate/applications/:id/restore',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handleRestoreApplication),
  );
  app.get('/api/v1/candidate/applications/funnel', withDeps(deps, handleApplicationFunnel));
  app.post(
    '/api/v1/candidate/applications/:id/events',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handleRecordApplicationEvent),
  );
  app.post(
    '/api/v1/candidate/visits',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handleRecordVisit),
  );
  registerTodayDecisionRoutes(app, deps);
  registerTodayChangesRoutes(app, deps);
  app.get('/api/v1/candidate/today', withDeps(deps, handleToday));
  registerApplicationMaterialsRoutes(app, deps);
  registerApplicationInterviewRoutes(app, deps);
  registerApplicationOfferRoutes(app, deps);
  registerStarPrepRoutes(app, deps);
  registerStarStoryRoutes(app, deps);
  registerInterviewSimulatorRoutes(app, deps);
  registerReferralTrackRoutes(app, deps);
  registerCareerVectorRoutes(app, deps);
  registerCareerDiaryRoutes(app, deps);
  registerDecisionProfileRoutes(app, deps);
  registerRelocationQuestionnaireRoutes(app, deps);
  registerVacancySkipRoutes(app, deps);
  registerCandidateAutomationRoutes(app, deps);
}
