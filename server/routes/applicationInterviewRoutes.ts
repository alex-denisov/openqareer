import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, withDeps } from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const createInterviewSchema = z.object({
  round: z.number().int().positive(),
  scheduledAt: z.string().trim().min(1).nullable().optional(),
  format: z.string().trim().max(120).nullable().optional(),
});

const patchInterviewSchema = z.object({
  scheduledAt: z.string().trim().min(1).nullable().optional(),
  format: z.string().trim().max(120).nullable().optional(),
  prepStatus: z.enum(['none', 'ready']).optional(),
  prep: z.string().max(20_000).nullable().optional(),
  debrief: z.string().max(20_000).nullable().optional(),
});

const handleCreateInterview: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const applicationId = (request.params as { id: string }).id;
  const body = createInterviewSchema.parse(request.body);
  const created = candidateStore.createApplicationInterview(candidate.id, applicationId, body);
  return { data: created, meta: { requestId: request.id } };
};

const handlePatchInterview: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const params = request.params as { id: string; iid: string };
  const body = patchInterviewSchema.parse(request.body);
  const patched = candidateStore.patchApplicationInterview(candidate.id, params.id, params.iid, body);
  return { data: patched, meta: { requestId: request.id } };
};

/** `POST/PATCH /applications/:id/interviews[/:iid]` (B251, S2, architecture.md §3–4). */
export function registerApplicationInterviewRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/applications/:id/interviews',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, handleCreateInterview),
  );
  app.patch(
    '/api/v1/candidate/applications/:id/interviews/:iid',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handlePatchInterview),
  );
}
