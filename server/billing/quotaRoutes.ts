import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { FREE_SELECTION_FIT_LIMIT } from '../routes/fitSelectionSweep';
import type { RouteDeps } from '../routes/deps';
import { authenticateCandidate, withDeps } from '../routes/helpers';

/**
 * B579: остаток квот за текущий период — для экрана «Тарифы» и мест, где квота
 * тратится. Без включённого биллинга квот нет: `unlimited`, как и доступ к ИИ.
 */
function handleGetQuotas(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const { candidateStore, authService, config, billingRepository } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  reply.header('Cache-Control', 'no-store');
  if (config.billingEnforcement !== true || !billingRepository) {
    return {
      data: { plan: null, unlimited: true, period: null, quotas: [], fitPercentLimit: null },
      meta: { requestId: request.id },
    };
  }
  const summary = billingRepository.getQuotaSummary(candidate.id, new Date().toISOString());
  return {
    data: {
      ...summary,
      fitPercentLimit: summary.plan === 'free' ? FREE_SELECTION_FIT_LIMIT : null,
    },
    meta: { requestId: request.id },
  };
}

export function registerQuotaRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/billing/quotas', withDeps(deps, handleGetQuotas));
}
