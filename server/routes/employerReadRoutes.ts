import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin } from './helpers';
import {
  notificationRepositoryFor,
  recordNotificationFromSource,
} from './notificationRepositoryAccess';
import { ApplicationNotFoundError } from '../data/store/errors';

/**
 * B543: «Отметить: прочитано» в блоке «Доставка» карточки отклика. Отметка
 * кандидата пишет уведомление `employer_opened_letter`, из которого полоса
 * «Сегодня» (B542) собирает «<Компания> открыл письмо»; «Отменить» снимает
 * и отметку, и уведомление.
 */
const applicationParams = z.object({ id: z.string().min(1).max(200) });
const markInput = z.object({ readAt: z.string().datetime().optional() }).strict();

export function manualReadIdempotencyKey(applicationId: string): string {
  return `manual-read:${applicationId}`;
}

function candidateFor(request: FastifyRequest, reply: FastifyReply, deps: RouteDeps) {
  return authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
}

export function registerEmployerReadRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const url = '/api/v1/candidate/applications/:id/employer-read';
  const limited = { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } };

  app.get(url, async (request, reply) => {
    const candidate = candidateFor(request, reply, deps);
    if (!candidate) return undefined;
    const { id } = applicationParams.parse(request.params);
    if (!deps.candidateStore.getApplication(candidate.id, id))
      throw new ApplicationNotFoundError(id);
    const mark = deps.candidateStore.getEmployerRead?.(candidate.id, id) ?? null;
    return { data: mark, meta: { requestId: request.id } };
  });

  app.post(url, limited, async (request, reply) => {
    if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
    const candidate = candidateFor(request, reply, deps);
    if (!candidate) return undefined;
    const { id } = applicationParams.parse(request.params);
    const { readAt } = markInput.parse(request.body ?? {});
    const application = deps.candidateStore.getApplication(candidate.id, id);
    if (!application) throw new ApplicationNotFoundError(id);
    if (application.stage === 'saved' || !deps.candidateStore.markEmployerRead)
      return reply.code(409).send({
        error: { code: 'application_not_sent', message: 'Отклик ещё не отправлен.' },
      });
    const mark = deps.candidateStore.markEmployerRead(candidate.id, id, {
      readAt: readAt ?? new Date().toISOString(),
      source: 'candidate',
    });
    if (mark.source === 'candidate')
      recordNotificationFromSource(deps, request, candidate.id, {
        kind: 'employer_opened_letter',
        sourceType: 'application',
        sourceId: id,
        idempotencyKey: manualReadIdempotencyKey(id),
      });
    return { data: mark, meta: { requestId: request.id } };
  });

  app.delete(url, limited, async (request, reply) => {
    if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
    const candidate = candidateFor(request, reply, deps);
    if (!candidate) return undefined;
    const { id } = applicationParams.parse(request.params);
    if (!deps.candidateStore.getApplication(candidate.id, id))
      throw new ApplicationNotFoundError(id);
    if (deps.candidateStore.clearEmployerRead?.(candidate.id, id))
      notificationRepositoryFor(deps).withdrawEvent(candidate.id, manualReadIdempotencyKey(id));
    const mark = deps.candidateStore.getEmployerRead?.(candidate.id, id) ?? null;
    return { data: mark, meta: { requestId: request.id } };
  });
}
