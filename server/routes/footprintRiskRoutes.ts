import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { buildFootprintRiskSummary } from '../domain/footprintRisk';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B667: сводка цифрового следа для кабинета B640. Только чтение сохранённых
 * находок: новых проверок маршрут не запускает и к внешним источникам не ходит.
 * Начинается с `requireCabinetB640`: без флага адрес отвечает как несуществующий.
 */
async function handleGetFootprintRisks(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  if (!principal.candidate) {
    return sendError(
      reply,
      request,
      401,
      'unauthorized',
      'Нужна действующая сессия кандидата.',
      false,
    );
  }
  const repository = deps.candidateReputationRepo;
  const candidateId = principal.candidate.id;
  const audit = repository?.getLatestFootprintAudit(candidateId) ?? null;
  const discrepancies =
    repository?.getLatestAudit(candidateId, { trustedOnly: true })?.consistencyDiscrepancies ?? [];
  reply.header('Cache-Control', 'no-store');
  return {
    data: buildFootprintRiskSummary(audit, discrepancies),
    meta: { requestId: request.id },
  };
}

export function registerFootprintRiskRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/footprint/risks', withDeps(deps, handleGetFootprintRisks));
}
