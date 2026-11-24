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
import { registerInterviewRecordingRoutes } from './interviewRecordingRoutes';
import { isoDateField } from './isoDateField';
import {
  notificationRepositoryFor,
  recordNotificationFromSource,
} from './notificationRepositoryAccess';
import { closeRecordingRuntime, recordingRuntimeFor } from '../recordings/recordingRuntime';
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

/** B731: напоминание появляется в ленте и уходит за сутки до интервью. */
const REMINDER_LEAD_MS = 24 * 60 * 60 * 1_000;

/** Сбой уведомлений не ломает правку интервью: оно уже сохранено, ошибка — в журнал. */
function withdrawInterviewReminder(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  interviewId: string,
): void {
  try {
    notificationRepositoryFor(deps).withdrawUnsentFromSource(candidateId, 'interview', interviewId);
  } catch (error) {
    request.log.error(
      {
        code: 'interview_reminder_withdraw_failed',
        candidateId,
        failureType: error instanceof Error ? error.name : 'UnknownError',
      },
      'interview-reminder-withdraw-failed',
    );
  }
}

function recordInterviewReminder(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  interview: { readonly id: string; readonly scheduledAt: string | null },
): void {
  // Новая, перенесённая или снятая дата: прежнее неушедшее напоминание больше не верно.
  withdrawInterviewReminder(deps, request, candidateId, interview.id);
  if (!interview.scheduledAt) return;
  const now = new Date().toISOString();
  // Прошедшее интервью записывают для истории: напоминать не о чем.
  if (Date.parse(interview.scheduledAt) <= Date.parse(now)) return;
  const deliverAt = new Date(Date.parse(interview.scheduledAt) - REMINDER_LEAD_MS).toISOString();
  recordNotificationFromSource(deps, request, candidateId, {
    kind: 'interview_reminder',
    sourceType: 'interview',
    sourceId: interview.id,
    idempotencyKey: `interview-reminder:${interview.id}:${interview.scheduledAt}`,
    // Меньше суток до интервью — в ленте сразу, по каналам не уходит.
    createdAt: deliverAt > now ? deliverAt : now,
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
  recordInterviewReminder(deps, request, candidate.id, created);
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
    recordInterviewReminder(deps, request, candidate.id, patched);
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
    // B642: записи интервью (только тексты) уходят вместе с ним.
    recordingRuntimeFor(deps, request.log).repository.deleteByInterview(candidate.id, params.iid);
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
  // B642: до редакции 1.3 юридических документов маршрутов записи нет; удаление интервью
  // всё равно стирает его записи, поэтому хранилище закрывается при остановке в любом случае.
  if (deps.config.interviewRecordingEnabled) registerInterviewRecordingRoutes(app, deps);
  else app.addHook('onClose', () => closeRecordingRuntime(deps));
}
