import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { isoDateField } from './isoDateField';
import {
  notificationRepositoryFor,
  recordNotificationFromSource,
} from './notificationRepositoryAccess';
import { ApplicationNotFoundError } from '../data/store/errors';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const createInterviewSchema = z.object({
  round: z.number().int().positive(),
  scheduledAt: isoDateField.nullable().optional(),
  format: z.string().trim().max(120).nullable().optional(),
});

const patchInterviewSchema = z.object({
  scheduledAt: isoDateField.nullable().optional(),
  format: z.string().trim().max(120).nullable().optional(),
  prepStatus: z.enum(['none', 'ready']).optional(),
  prep: z.string().max(20_000).nullable().optional(),
  debrief: z.string().max(20_000).nullable().optional(),
  followUpDueAt: isoDateField.nullable().optional(),
});

/** B731: напоминание уходит за сутки до интервью; если сутки уже прошли — по каналам не уходит. */
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1_000;

function recordInterviewReminder(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  interview: { readonly id: string; readonly scheduledAt: string | null },
  createdAt: string,
): void {
  if (!interview.scheduledAt) return;
  const deliverAt = new Date(Date.parse(interview.scheduledAt) - REMINDER_LEAD_MS).toISOString();
  recordNotificationFromSource(deps, request, candidateId, {
    kind: 'interview_reminder',
    sourceType: 'interview',
    sourceId: interview.id,
    idempotencyKey: `interview-reminder:${interview.id}:${interview.scheduledAt}`,
    createdAt,
    deliverAt,
  });
}

const handleCreateInterview: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const applicationId = (request.params as { id: string }).id;
  const body = createInterviewSchema.parse(request.body);
  const created = candidateStore.createApplicationInterview(candidate.id, applicationId, body);
  recordInterviewReminder(deps, request, candidate.id, created, created.createdAt);
  return { data: created, meta: { requestId: request.id } };
};

const handlePatchInterview: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const params = request.params as { id: string; iid: string };
  const body = patchInterviewSchema.parse(request.body);
  const patched = candidateStore.patchApplicationInterview(
    candidate.id,
    params.id,
    params.iid,
    body,
  );
  if (patched && body.scheduledAt !== undefined) {
    // Новая или снятая дата: прежнее неушедшее напоминание больше не верно.
    notificationRepositoryFor(deps).withdrawUnsentFromSource(candidate.id, 'interview', patched.id);
    recordInterviewReminder(deps, request, candidate.id, patched, new Date().toISOString());
  }
  if (body.followUpDueAt !== undefined) {
    const app = candidateStore.getApplication(candidate.id, params.id);
    if (app) {
      candidateStore.patchApplication(candidate.id, params.id, {
        expectedVersion: app.version,
        followUpDueAt: body.followUpDueAt,
      });
    }
  }
  return { data: patched, meta: { requestId: request.id } };
};

type InterviewRemoval = 'deleted' | 'missing' | 'foreign';

function removeOwnInterview(
  deps: RouteDeps,
  candidateId: string,
  params: { id: string; iid: string },
): InterviewRemoval {
  try {
    const removed = deps.candidateStore.deleteApplicationInterview?.(
      candidateId,
      params.id,
      params.iid,
    );
    return removed ? 'deleted' : 'missing';
  } catch (error) {
    if (error instanceof ApplicationNotFoundError) return 'foreign';
    throw error;
  }
}

/**
 * Тестовое или ошибочное интервью снимается вместе с напоминанием, которое ещё не ушло;
 * ушедшее остаётся в истории уведомлений.
 */
const handleDeleteInterview: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const params = request.params as { id: string; iid: string };
  const removal = removeOwnInterview(deps, candidate.id, params);
  // Отклик свой: снять неушедшее напоминание и при повторе, если прошлый раз оборвался после
  // удаления интервью (хранилища разные, общей транзакции нет). Фильтр по кандидату.
  if (removal !== 'foreign') {
    notificationRepositoryFor(deps).withdrawUnsentFromSource(candidate.id, 'interview', params.iid);
  }
  if (removal !== 'deleted') {
    return sendError(reply, request, 404, 'interview_not_found', 'Интервью не найдено.', false);
  }
  return { data: { interviewId: params.iid, deleted: true }, meta: { requestId: request.id } };
};

/** `POST/PATCH /applications/:id/interviews[/:iid]` (B251, S2, architecture.md §3–4). */
export function registerApplicationInterviewRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/applications/:id/interviews',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, handleCreateInterview),
  );
  app.patch(
    '/api/v1/candidate/applications/:id/interviews/:iid',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handlePatchInterview),
  );
  app.delete(
    '/api/v1/candidate/applications/:id/interviews/:iid',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handleDeleteInterview),
  );
}
