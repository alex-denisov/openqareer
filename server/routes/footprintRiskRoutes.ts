import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { buildFootprintRiskSummary, mismatchKey } from '../domain/footprintRisk';
import { isFootprintRunActive } from '../osint/candidateFootprintWorker';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { csrfError, hasSafeMutationOrigin, sendError, withDeps } from './helpers';

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
    data: buildFootprintRiskSummary(audit, discrepancies, {
      checkRunning: audit ? isFootprintRunActive(audit.id) : false,
    }),
    meta: { requestId: request.id },
  };
}

const mismatchIdSchema = z.string().regex(/^mismatch:[A-Za-z0-9_-]{1,80}$/u);
const mismatchReviewSchema = z.object({ review: z.enum(['hidden', 'unreviewed']) }).strict();

/** Расхождение из последней проверки резюме; `pending` — проверки следа ещё нет. */
function findMismatch(deps: RouteDeps, candidateId: string, mismatchId: string) {
  const repository = deps.candidateReputationRepo;
  const footprint = repository?.getLatestFootprintAudit(candidateId);
  if (!repository || !footprint || footprint.state === 'pending') return 'pending' as const;
  const discrepancyId = mismatchId.slice('mismatch:'.length);
  const discrepancy = repository
    .getLatestAudit(candidateId, { trustedOnly: true })
    ?.consistencyDiscrepancies.find((entry) => entry.id === discrepancyId);
  return discrepancy ? { repository, discrepancy } : null;
}

/**
 * B645 p02: «Это не проблема» у расхождения с резюме и «Отменить». Отметка
 * хранится в последней проверке следа по ключу содержания расхождения.
 */
async function handleReviewMismatch(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const fail = (status: number, code: string, message: string) =>
    sendError(reply, request, status, code, message, false);
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidateId = principal.candidate?.id;
  if (!candidateId) return fail(401, 'unauthorized', 'Нужна действующая сессия кандидата.');
  const id = mismatchIdSchema.safeParse((request.params as { mismatchId?: unknown }).mismatchId);
  const decision = mismatchReviewSchema.safeParse(request.body);
  if (!id.success || !decision.success) {
    return fail(400, 'invalid_review', 'Выберите одно из действий для находки.');
  }
  const found = findMismatch(deps, candidateId, id.data);
  if (found === 'pending') {
    return fail(409, 'audit_not_complete', 'Находки можно отметить после проверки.');
  }
  if (!found) return fail(404, 'finding_not_found', 'Находка больше недоступна.');
  found.repository.updateFootprintMismatchReview(
    candidateId,
    mismatchKey(found.discrepancy),
    decision.data.review,
  );
  return { data: { id: id.data, review: decision.data.review }, meta: { requestId: request.id } };
}

export function registerFootprintRiskRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/footprint/risks', withDeps(deps, handleGetFootprintRisks));
  app.patch(
    '/api/v1/candidate/footprint/mismatches/:mismatchId',
    withDeps(deps, handleReviewMismatch),
  );
}
