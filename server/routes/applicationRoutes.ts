import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { APPLICATION_STAGES } from '../../shared/applicationStage';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, withDeps } from './helpers';
import { timezoneOffsetSchema } from './timezoneQuery';
import { registerApplicationMaterialsRoutes } from './applicationMaterialsRoutes';
import { registerApplicationInterviewRoutes } from './applicationInterviewRoutes';
import { registerApplicationOfferRoutes } from './applicationOfferRoutes';
import { registerVacancySkipRoutes } from './vacancySkipRoutes';

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
    occurredAt: z.string().trim().min(1).optional(),
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
  occurredAt: z.string().trim().min(1).optional(),
  notes: z.string().max(20_000).nullable().optional(),
  processProfile: z.enum(['standard', 'executive']).optional(),
  followUpDueAt: z.string().trim().min(1).nullable().optional(),
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
  occurredAt: z.string().trim().min(1),
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
  registerApplicationMaterialsRoutes(app, deps);
  registerApplicationInterviewRoutes(app, deps);
  registerApplicationOfferRoutes(app, deps);
  registerVacancySkipRoutes(app, deps);
}
