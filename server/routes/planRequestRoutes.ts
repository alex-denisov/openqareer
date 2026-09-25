import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, sendError, withDeps } from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const planRequestSchema = z.object({
  planId: z.enum(['consultant', 'automation']),
  note: z.string().trim().max(500).optional(),
});

/**
 * B266: «Оставить заявку» on a paid plan before payment exists. The request is
 * stored so the owner can answer it; a repeat returns the same request.
 */
const handleCreatePlanRequest: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const parsed = planRequestSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'plan_request_invalid', 'Выберите тариф для заявки.', false);
  }
  if (!candidateStore.requestPlan) {
    return sendError(reply, request, 503, 'plan_requests_unavailable', 'Заявки временно не принимаются.', true);
  }
  const stored = candidateStore.requestPlan(candidate.id, parsed.data.planId, parsed.data.note);
  request.log.info({ planId: stored.planId }, 'plan_request_received');
  return { data: stored, meta: { requestId: request.id } };
};

const handleListPlanRequests: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  return { data: candidateStore.listPlanRequests?.(candidate.id) ?? [], meta: { requestId: request.id } };
};

export function registerPlanRequestRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/plan-requests', withDeps(deps, handleListPlanRequests));
  app.post(
    '/api/v1/candidate/plan-requests',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    withDeps(deps, handleCreatePlanRequest),
  );
}
