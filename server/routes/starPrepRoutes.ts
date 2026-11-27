import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { ApplicationView } from '../domain/applicationDerivedFields';
import { interviewVacancyAsks } from '../domain/interviewVacancyAsks';
import { vacancyDescriptionHash } from '../domain/vacancyRequirements';
import type { InterviewAsk } from '../../shared/interviewAsks';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { putStarPrepSchema } from './starPrepValidation';
import { readVacancyFitTarget } from './vacancyFitContext';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const EMPTY = (applicationId: string) => ({
  applicationId,
  paragraphs: [],
  version: 0,
  updatedAt: null,
});

/**
 * B635: о чём спрашивает описание вакансии. Текст — из пула, пока он полнее снимка отклика;
 * требования — уже извлечённые из него (B510), без модели и очереди.
 */
function vacancyAsks(deps: RouteDeps, application: ApplicationView): readonly InterviewAsk[] {
  const snapshot = application.vacancy?.description?.trim() ?? '';
  const target = application.clusterId
    ? readVacancyFitTarget(deps, application.clusterId)
    : undefined;
  const extracted = target
    ? deps.vacancyMechanics?.requirements.getLatestOrLegacy(
        target.vacancyId,
        vacancyDescriptionHash(target.description),
      )
    : null;
  const pooled = target?.description.trim() ?? '';
  const usePool =
    pooled.length > 0 && (extracted?.requirements.length || pooled.length >= snapshot.length);
  return usePool
    ? interviewVacancyAsks(pooled, extracted?.requirements)
    : interviewVacancyAsks(snapshot);
}

const handleGetStarPrep: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const applicationId = (request.params as { id: string }).id;
  const application = candidateStore.getApplication(candidate.id, applicationId);
  if (!application) {
    return sendError(reply, request, 404, 'application_not_found', 'Отклик не найден', false);
  }
  const stored = candidateStore.starPrepRepo.get(candidate.id, applicationId);
  return {
    data: { ...(stored ?? EMPTY(applicationId)), asks: vacancyAsks(deps, application) },
    meta: { requestId: request.id },
  };
};

const handlePutStarPrep: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const applicationId = (request.params as { id: string }).id;
  const body = putStarPrepSchema.parse(request.body);
  if (!candidateStore.getApplication(candidate.id, applicationId)) {
    return sendError(reply, request, 404, 'application_not_found', 'Отклик не найден', false);
  }
  const stored = candidateStore.starPrepRepo.put(
    candidate.id,
    applicationId,
    body.paragraphs,
    new Date().toISOString(),
  );
  return { data: stored, meta: { requestId: request.id } };
};

/** `GET/PUT /applications/:id/star-prep` (B392): подготовка STAR на факт-источниках. */
export function registerStarPrepRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/applications/:id/star-prep',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handleGetStarPrep),
  );
  app.put(
    '/api/v1/candidate/applications/:id/star-prep',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handlePutStarPrep),
  );
}
