import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  REJECTION_NOTE_MAX_LENGTH,
  REJECTION_REASONS,
  type RejectionGuess,
} from '../../shared/rejectionReview';
import { SqliteRejectionReviewRepository } from '../candidate/sqliteRejectionReviewRepository';
import {
  buildRejectionReview,
  guessFromFit,
  rejectedForReview,
  type RejectionReviewApplication,
} from '../domain/rejectionReview';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { readVacancyFitTarget, vacancyFitContext } from './vacancyFitContext';

/**
 * B679: разбор отказов для нового кабинета. Все маршруты начинаются с `requireCabinetB640`:
 * без флага они отвечают как несуществующий адрес и ничего не пишут. Догадка берётся из уже
 * посчитанной сверки вакансии с профилем: маршрут не ставит задач и не зовёт модель.
 */
export type RejectionReviewRouteDeps = RouteDeps & {
  readonly rejectionReviewRepository?: SqliteRejectionReviewRepository;
};

type BoundDeps = RouteDeps & { readonly review: SqliteRejectionReviewRepository };
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const APPLICATION_ID_MAX_LENGTH = 200;
const reasonSchema = z
  .object({
    reason: z.enum(REJECTION_REASONS),
    note: z.string().max(REJECTION_NOTE_MAX_LENGTH).nullish(),
  })
  .strict();
const feedbackSchema = z.object({ helped: z.boolean() }).strict();

function candidateId(deps: BoundDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

/** Догадка по одному отказу; сверки нет или вакансия ушла из подбора — `null`. */
function guessFor(
  deps: BoundDeps,
  request: FastifyRequest,
  candidate: string,
  clusterId: string | null,
): RejectionGuess | null {
  const runtime = deps.vacancyMechanics;
  if (!runtime || !clusterId) return null;
  try {
    const target = readVacancyFitTarget(deps, clusterId);
    if (!target) return null;
    const input = vacancyFitContext(deps, candidate, target, []);
    return guessFromFit(runtime.view(input, { queueRequirements: false }));
  } catch (error) {
    request.log.warn({ error }, 'rejection_review_guess_failed');
    return null;
  }
}

const getReview: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return reply;
  const stored = deps.candidateStore.listApplications(candidate);
  const applications: RejectionReviewApplication[] = stored.map((application) => ({
    id: application.id,
    stage: application.stage,
    title: application.vacancy?.title ?? '',
    company: application.vacancy?.company || null,
    stageChangedAt: application.stageChangedAt,
  }));
  const clusters = new Map(stored.map((application) => [application.id, application.clusterId]));
  const guesses = new Map(
    rejectedForReview(applications).map((application) => [
      application.id,
      guessFor(deps, request, candidate, clusters.get(application.id) ?? null),
    ]),
  );
  return {
    data: buildRejectionReview({
      applications,
      guesses,
      reasons: deps.review.reasons(candidate),
      helped: deps.review.helped(candidate),
    }),
    meta: { requestId: request.id },
  };
};

const putReason: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return reply;
  const id = (request.params as { id: string }).id;
  const parsed = reasonSchema.safeParse(request.body ?? {});
  if (id.length > APPLICATION_ID_MAX_LENGTH || !parsed.success) {
    return sendError(reply, request, 400, 'invalid_rejection_reason', 'Выберите причину из списка.', false);
  }
  const application = deps.candidateStore.getApplication(candidate, id);
  if (!application) {
    return sendError(reply, request, 404, 'application_not_found', 'Отклик не найден.', false);
  }
  if (application.stage !== 'rejected') {
    return sendError(reply, request, 409, 'application_not_rejected', 'Причину отмечают у отказа.', false);
  }
  const saved = deps.review.saveReason({
    candidateId: candidate,
    applicationId: application.id,
    reason: parsed.data.reason,
    note: parsed.data.note?.trim() || null,
    recordedAt: new Date().toISOString(),
  });
  return { data: saved, meta: { requestId: request.id } };
};

const putFeedback: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return reply;
  const parsed = feedbackSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_review_feedback', 'Ответьте «да» или «нет».', false);
  }
  deps.review.saveHelped(candidate, parsed.data.helped, new Date().toISOString());
  return { data: { helped: parsed.data.helped }, meta: { requestId: request.id } };
};

export function registerRejectionReviewRoutes(
  app: FastifyInstance,
  deps: RejectionReviewRouteDeps,
): void {
  const repository =
    deps.rejectionReviewRepository ??
    new SqliteRejectionReviewRepository({
      databasePath: deps.config.databasePath,
      encryptionKey: deps.config.dataEncryptionKey,
    });
  if (!deps.rejectionReviewRepository) app.addHook('onClose', async () => repository.close());
  const bound: BoundDeps = { ...deps, review: repository };
  const write = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  app.get('/api/v1/candidate/applications/rejection-review', withDeps(bound, getReview));
  app.put(
    '/api/v1/candidate/applications/rejection-review/feedback',
    write,
    withDeps(bound, putFeedback),
  );
  app.put(
    '/api/v1/candidate/applications/:id/rejection-reason',
    write,
    withDeps(bound, putReason),
  );
}
