import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { APPLICATION_STAGES } from '../../shared/applicationStage';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, withDeps } from './helpers';
import { timezoneOffsetSchema } from './timezoneQuery';
import { isoDateField } from './isoDateField';
import { registerApplicationMaterialsRoutes } from './applicationMaterialsRoutes';
import { registerApplicationInterviewRoutes } from './applicationInterviewRoutes';
import { registerApplicationOfferRoutes } from './applicationOfferRoutes';
import { registerVacancySkipRoutes } from './vacancySkipRoutes';
import { readCampaign } from './campaignContext';
import { peekMatchedVacancies, readMatchProfile } from '../vacancies/matchedPoolContext';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { readTargetLevel } from './vacancyRoleContext';
import { buildTodaySnapshot, type TodayNewVacancy } from '../domain/todayDigest';

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

const patchApplicationSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  stage: stageSchema.optional(),
  occurredAt: isoDateField.optional(),
  notes: z.string().max(20_000).nullable().optional(),
  processProfile: z.enum(['standard', 'executive']).optional(),
  followUpDueAt: isoDateField.nullable().optional(),
});

const listApplicationsQuerySchema = z.object({ tz: timezoneOffsetSchema });

const handleListApplications: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, multiSourceEngine } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { tz } = listApplicationsQuerySchema.parse(request.query ?? {});
  return {
    data: candidateStore.listApplications(candidate.id, {
      timezoneOffsetMinutes: tz,
      isVacancyGone: (clusterId) => multiSourceEngine.isKnownVacancyGone(clusterId),
    }),
    meta: { requestId: request.id },
  };
};

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
  const patched = candidateStore.patchApplication(candidate.id, applicationId, body);
  return { data: patched, meta: { requestId: request.id } };
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

const todayQuerySchema = z.object({ tz: ianaTimezoneSchema });

/**
 * Тот же отпечаток снимка, что и у самого подбора (уровень включительно):
 * иначе `/today` смотрел бы ключ без уровня и никогда не находил снимок,
 * записанный с уровнем, и вечно отдавал `vacanciesPending: true`.
 */
function peekTodayMatchedVacancies(
  deps: Pick<RouteDeps, 'candidateStore' | 'multiSourceEngine'>,
  candidateId: string,
): { matched: MatchedVacancyItem[] | undefined; targetRoles: readonly string[] } {
  const { candidateStore, multiSourceEngine } = deps;
  const { confirmedSkills } = readMatchProfile(candidateStore, candidateId);
  const campaign = readCampaign(candidateStore, candidateId);
  const targetRoles = [...campaign.roles.value];
  const targetLevel = readTargetLevel(candidateStore, candidateId, targetRoles);
  const matched = peekMatchedVacancies(
    multiSourceEngine,
    candidateId,
    confirmedSkills,
    targetRoles,
    targetLevel,
  );
  return { matched, targetRoles };
}

/**
 * `GET /today` (architecture.md §4, §57, §97): дайджест дня. Подбор читается
 * из уже готового снимка (`peekMatchedVacancies`) — холодный кэш отдаёт
 * `undefined`, а не запускает синхронный подбор в HTTP-обработчике (B230).
 */
const handleToday: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, multiSourceEngine } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  todayQuerySchema.parse(request.query ?? {});

  const since = candidateStore.getSinceLastVisit(candidate.id);
  const applications = candidateStore.listApplications(candidate.id, {
    isVacancyGone: (clusterId) => multiSourceEngine.isKnownVacancyGone(clusterId),
  });

  const { matched, targetRoles } = peekTodayMatchedVacancies(deps, candidate.id);
  const newVacancies: TodayNewVacancy[] | undefined = matched?.map((item) => ({
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
      level: item.explanation.levelMatch ?? null,
      // Ничего в объяснении совпадения пока не сравнивает гео кандидата с
      // вакансией (unifiedVacancy.ts): точку не рисуем из отсутствия данных (PRB-016).
      geo: null as boolean | null,
    },
  }));
  const freshNewVacancies =
    newVacancies === undefined
      ? undefined
      : newVacancies.filter(
          (vacancy) =>
            vacancy.fit.role !== 'none' && (since === null || vacancy.firstObservedAt > since),
        );

  const closedVacanciesSinceVisit =
    since === null ? 0 : candidateStore.countSystemClosuresSince(candidate.id, since);
  const companyEventsSinceVisit =
    since === null ? 0 : candidateStore.countCompanyEventsSince(candidate.id, since);

  const snapshot = buildTodaySnapshot({
    applications,
    newVacancies: freshNewVacancies,
    since,
    closedVacanciesSinceVisit,
    campaignRole: targetRoles[0] ?? null,
    companyEventsSinceVisit,
    ...(newVacancies ? { shortlist: newVacancies } : {}),
  });
  return { data: snapshot, meta: { requestId: request.id } };
};

/** Трекер откликов (B251, S1–S2, architecture.md §4). */
export function registerApplicationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/applications', withDeps(deps, handleListApplications));
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
  app.get('/api/v1/candidate/today', withDeps(deps, handleToday));
  registerApplicationMaterialsRoutes(app, deps);
  registerApplicationInterviewRoutes(app, deps);
  registerApplicationOfferRoutes(app, deps);
  registerVacancySkipRoutes(app, deps);
}
