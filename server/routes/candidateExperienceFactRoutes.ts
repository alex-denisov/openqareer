import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CandidateStoreConflictError } from '../data/sqliteCandidateStore';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { manualExperienceFactSchema } from './schemas';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const handleAddManualExperienceFact: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const memoryId = z.string().uuid().parse(request.headers['idempotency-key']);
  const input = manualExperienceFactSchema.parse(request.body);
  try {
    const memory = candidateStore.addManualExperienceFact(
      candidate.id,
      memoryId,
      input.statement,
      input.experienceId,
    );
    return { data: { memory }, meta: { requestId: request.id } };
  } catch (error) {
    if (!(error instanceof CandidateStoreConflictError)) throw error;
    return sendError(
      reply,
      request,
      409,
      'experience_fact_conflict',
      'Позиция опыта изменилась. Обновите профиль и повторите.',
      true,
    );
  }
};

export async function registerCandidateExperienceFactRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.post(
    '/api/v1/candidate/experience-facts',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    withDeps(deps, handleAddManualExperienceFact),
  );
}
