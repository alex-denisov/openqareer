import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { B640ApplicationQuota } from '../../shared/b640Vacancies';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { withDeps } from './helpers';
import { sessionCandidate } from './b640VacancyContext';

const NO_LIMIT: B640ApplicationQuota = {
  plan: null,
  limit: null,
  used: 0,
  remaining: null,
  renewsAt: null,
};

/** Остаток откликов по тарифу: те же период и расход, что у списания, но ничего не списывает. */
function readQuota(deps: RouteDeps, candidateId: string): B640ApplicationQuota {
  const { config, billingRepository } = deps;
  if (config.billingEnforcement !== true || !billingRepository) return NO_LIMIT;
  const summary = billingRepository.getQuotaSummary(candidateId, new Date().toISOString());
  const status = summary.quotas.find(({ key }) => key === 'applications');
  if (!status) return NO_LIMIT;
  return {
    plan: summary.plan,
    limit: summary.unlimited ? null : status.limit,
    used: status.used,
    remaining: summary.unlimited ? null : status.remaining,
    renewsAt: summary.period.endsAt,
  };
}

const getApplicationQuota = async (
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> => {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  reply.header('Cache-Control', 'no-store');
  return { data: readQuota(deps, candidate.id), meta: { requestId: request.id } };
};

/** B674: остаток откликов по тарифу для кабинета B640; только чтение. */
export function registerB640ApplicationQuotaRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/b640/application-quota', withDeps(deps, getApplicationQuota));
}
