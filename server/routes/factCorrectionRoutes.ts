import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { factCorrectionRevertSchema, factCorrectionSchema } from '../../shared/factCorrection';
import { FactCorrectionNotSavedError } from '../data/factCorrectionMethods';
import { CandidateStoreConflictError } from '../data/store/errors';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B796: исправление факта кандидатом. Меняет запись и все её копии; ответ «исправлено» — только после
 * перечитывания записанного. Ещё не отправленное приводится к новому факту: правки резюме под вакансию,
 * сообщения (снова ждут одобрения), варианты текстов. Письма сверяет с профилем `letterFreshness`.
 */
const BASE = '/api/v1/candidate/fact-corrections';

function failure(error: unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof CandidateStoreConflictError) {
    const words = 'Запись изменилась. Откройте её снова.';
    return sendError(reply, request, 409, 'fact_correction_stale', words, false);
  }
  if (error instanceof FactCorrectionNotSavedError) {
    const words = 'Исправить не получилось, запись прежняя.';
    return sendError(reply, request, 500, 'fact_correction_not_saved', words, true);
  }
  throw error;
}

function candidateOf(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (principal.candidate) return principal.candidate.id;
  sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
  return null;
}

const invalid = (request: FastifyRequest, reply: FastifyReply) =>
  sendError(reply, request, 400, 'invalid_fact_correction', 'Правка не прошла проверку.', false);

async function handleCorrect(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = factCorrectionSchema.safeParse(request.body);
  if (!parsed.success) return invalid(request, reply);
  try {
    const data = deps.candidateStore.correctFact(candidateId, parsed.data);
    return { data, meta: { requestId: request.id } };
  } catch (error) {
    return failure(error, request, reply);
  }
}

async function handleRevert(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = factCorrectionRevertSchema.safeParse(request.body);
  if (!parsed.success) return invalid(request, reply);
  try {
    deps.candidateStore.revertFactCorrection(candidateId, parsed.data.id);
    return { data: { reverted: true }, meta: { requestId: request.id } };
  } catch (error) {
    return failure(error, request, reply);
  }
}

export function registerFactCorrectionRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const limit = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
  app.post(BASE, limit, withDeps(deps, handleCorrect));
  app.post(`${BASE}/revert`, limit, withDeps(deps, handleRevert));
}
