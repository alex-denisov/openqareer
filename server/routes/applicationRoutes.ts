import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { APPLICATION_STAGES } from '../../shared/applicationStage';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, withDeps } from './helpers';

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
 * `POST /applications` (B251, S1, architecture.md §4). `clusterId` покрывает
 * карточку из подбора; ручная карточка «через рекрутера» посылает
 * `manualVacancy` без `clusterId` — S1 хранит её, интерфейса для неё ещё нет.
 */
const createApplicationSchema = z.object({
  clusterId: z.string().trim().min(1).max(200).optional(),
  manualVacancy: vacancySnapshotSchema.optional(),
  stage: stageSchema,
  occurredAt: z.string().trim().min(1).optional(),
});

const patchApplicationSchema = z.object({
  expectedVersion: z.number().int().nonnegative(),
  stage: stageSchema.optional(),
  occurredAt: z.string().trim().min(1).optional(),
  notes: z.string().max(20_000).nullable().optional(),
  processProfile: z.enum(['standard', 'executive']).optional(),
  followUpDueAt: z.string().trim().min(1).nullable().optional(),
});

const handleListApplications: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  return {
    data: deps.candidateStore.listApplications(candidate.id),
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
    vacancy: body.manualVacancy,
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

/** Трекер откликов (B251, S1, architecture.md §4). Интерфейса нет: только API. */
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
}
