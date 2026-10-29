import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin } from './helpers';
import { candidateCalendarDate, todayActionDeferralInputSchema } from '../../shared/todayDecision';
import { buildTodaySnapshot } from '../domain/todayDigest';

const selectionInput = z
  .object({
    applicationId: z.string().min(1).max(200),
    resolution: z.enum(['accepted', 'dismissed']),
  })
  .strict();

export function registerTodayDecisionRoutes(app: FastifyInstance, deps: RouteDeps) {
  registerTodayDecisionSelectionRoute(app, deps);
  registerTodayActionDeferralRoute(app, deps);
}

function registerTodayDecisionSelectionRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/v1/candidate/today/decision', async (request, reply) => {
    if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
    const candidate = authenticateCandidate(
      request,
      reply,
      deps.candidateStore,
      deps.authService,
      deps.config,
    );
    if (!candidate) return undefined;
    const body = selectionInput.parse(request.body);
    const workspace = deps.candidateStore.getCandidateWorkspace(candidate.id);
    if (!workspace)
      return reply.code(409).send({
        error: { code: 'workspace_required', message: 'Сначала завершите первый запуск.' },
      });
    const today = buildTodaySnapshot({
      applications: deps.candidateStore.listApplications(candidate.id),
      newVacancies: [],
      since: null,
      closedVacanciesSinceVisit: 0,
      campaignRole: null,
      companyEventsSinceVisit: 0,
    });
    const item = today.queue.find(
      (entry) => entry.applicationId === body.applicationId && entry.kind === 'follow_up',
    );
    if (!item)
      return reply.code(409).send({
        error: {
          code: 'decision_stale',
          message: 'Задача уже изменилась. Обновите очередь дня.',
        },
      });
    const selection = { ...body, updatedAt: new Date().toISOString() };
    deps.candidateStore.saveCandidateWorkspace(candidate.id, {
      ...workspace,
      todayDecisionSelection: selection,
    });
    return { data: selection, meta: { requestId: request.id } };
  });
}

function registerTodayActionDeferralRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/today/action-defer',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
      const candidate = authenticateCandidate(
        request,
        reply,
        deps.candidateStore,
        deps.authService,
        deps.config,
      );
      if (!candidate) return undefined;
      const body = todayActionDeferralInputSchema.parse(request.body);
      const workspace = deps.candidateStore.getCandidateWorkspace(candidate.id);
      if (!workspace)
        return reply.code(409).send({
          error: { code: 'workspace_required', message: 'Сначала завершите первый запуск.' },
        });
      const deferral = {
        actionId: body.actionId,
        deferredThroughDate: candidateCalendarDate(new Date(), body.tz),
        ...(body.resolution ? { resolution: body.resolution } : {}),
      };
      deps.candidateStore.saveCandidateWorkspace(candidate.id, {
        ...workspace,
        todayActionDeferral: deferral,
      });
      return { data: deferral, meta: { requestId: request.id } };
    },
  );
}
