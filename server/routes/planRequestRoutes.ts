import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { notifyOwner } from '../notifications/ownerTelegram';
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
  const isRepeat = (candidateStore.listPlanRequests?.(candidate.id) ?? []).some(
    (existing) => existing.planId === parsed.data.planId,
  );
  const stored = candidateStore.requestPlan(candidate.id, parsed.data.planId, parsed.data.note);
  request.log.info({ planId: stored.planId, isRepeat }, 'plan_request_received');
  if (!isRepeat) void alertOwner(deps, candidate, stored.planId, parsed.data.note);
  return { data: stored, meta: { requestId: request.id } };
};

const PLAN_TITLES: Readonly<Record<string, string>> = {
  consultant: 'С консультантом',
  automation: 'Автоматизация',
};

async function alertOwner(
  deps: RouteDeps,
  candidate: { readonly id: string },
  planId: string,
  note: string | undefined,
): Promise<void> {
  const fullName = deps.candidateStore.getSnapshot(candidate.id)?.resume?.draft?.candidate?.fullName;
  const lines = [
    `Новая заявка на тариф «${PLAN_TITLES[planId] ?? planId}»`,
    `Кандидат: ${fullName ? `${fullName} · ` : ''}${candidate.id}`,
    note ? `Комментарий: ${note}` : null,
  ].filter(Boolean);
  await notifyOwner(deps.config, lines.join('\n'));
}

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
