import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ExecutiveRequestCapacityError,
  ExecutiveRequestIdempotencyConflictError,
  ExecutiveRequestRateLimitError,
  ExecutiveRequestStatusTransitionError,
} from '../data/store/executiveRequestStore';
import type {
  CandidateIdentity,
  ExecutiveRequestInput,
  ExecutiveRequestStatus,
} from '../data/candidateStore';
import { notifyOwner } from '../notifications/ownerTelegram';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { requireAdmin, requireAdminMutation } from './adminAuth';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const executiveRequestSchema = z.object({
  task: z.string().trim().min(10).max(1_000),
  timeline: z.string().trim().min(2).max(160),
  profileSharingConsent: z.literal(true),
});
const idempotencyKeySchema = z.string().uuid();
const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(512).optional(),
});
const queueQuerySchema = pageQuerySchema.extend({
  status: z
    .enum(['submitted', 'waitlisted', 'in_review', 'accepted', 'declined', 'completed'])
    .optional(),
});
const statusSchema = z.object({
  status: z.enum(['submitted', 'waitlisted', 'in_review', 'accepted', 'declined', 'completed']),
});

function parseExecutiveRequestInput(
  request: FastifyRequest,
  reply: FastifyReply,
): ExecutiveRequestInput | null {
  const idempotencyKey = idempotencyKeySchema.safeParse(request.headers['idempotency-key']);
  const body = executiveRequestSchema.safeParse(request.body ?? {});
  if (!idempotencyKey.success || !body.success) {
    sendError(
      reply,
      request,
      400,
      'executive_request_invalid',
      'Проверьте описание задачи и сроки, затем отправьте заявку ещё раз.',
      false,
    );
    return null;
  }
  return { ...body.data, idempotencyKey: idempotencyKey.data };
}

const handleCreateExecutiveRequest: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const input = parseExecutiveRequestInput(request, reply);
  if (!input) return undefined;
  if (!deps.candidateStore.createExecutiveRequest) {
    return sendError(
      reply,
      request,
      503,
      'executive_requests_unavailable',
      'Заявки временно не принимаются.',
      true,
    );
  }
  return submitExecutiveRequest(deps, request, reply, candidate, input);
};

async function submitExecutiveRequest(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidate: CandidateIdentity,
  input: ExecutiveRequestInput,
): Promise<unknown> {
  try {
    const result = deps.candidateStore.createExecutiveRequest!(
      candidate.id,
      input,
      deps.config.executiveRequestCapacity ?? 0,
    );
    setCreatedRequestHeaders(reply, result.request.id, result.replayed);
    request.log.info(
      {
        executiveRequestId: result.request.id,
        status: result.request.status,
        created: result.created,
      },
      'executive_request_received',
    );
    if (result.created)
      notifyExecutiveRequestTeam(deps, request, result.request.id, result.request.status);
    reply.code(result.created ? 201 : 200);
    return { data: result.request, meta: { requestId: request.id } };
  } catch (reason) {
    return sendExecutiveRequestError(request, reply, reason);
  }
}

function setCreatedRequestHeaders(reply: FastifyReply, requestId: string, replayed: boolean): void {
  reply.header('location', '/api/v1/candidate/executive-requests/' + requestId);
  if (replayed) reply.header('idempotency-replayed', 'true');
}

function notifyExecutiveRequestTeam(
  deps: RouteDeps,
  request: FastifyRequest,
  requestId: string,
  status: string,
): void {
  void notifyOwner(
    deps.config,
    ['Новая заявка Executive', 'ID заявки: ' + requestId, 'Статус: ' + status].join('\n'),
  ).then((outcome) => {
    request.log.info(
      { executiveRequestId: requestId, outcome },
      'executive_request_team_notification',
    );
  });
}

function sendExecutiveRequestError(
  request: FastifyRequest,
  reply: FastifyReply,
  reason: unknown,
): unknown {
  if (reason instanceof ExecutiveRequestRateLimitError) {
    reply.header('retry-after', String(reason.retryAfterSeconds));
    return sendError(
      reply,
      request,
      429,
      'executive_request_rate_limited',
      'Вы отправили много заявок. Попробуйте позже.',
      true,
    );
  }
  if (reason instanceof ExecutiveRequestIdempotencyConflictError) {
    return sendError(
      reply,
      request,
      409,
      'executive_request_idempotency_conflict',
      'Ключ отправки уже использован для другой заявки. Обновите форму и повторите попытку.',
      false,
    );
  }
  throw reason;
}

const handleListExecutiveRequests: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const query = pageQuerySchema.safeParse(request.query ?? {});
  if (!query.success) {
    return sendError(
      reply,
      request,
      400,
      'executive_request_query_invalid',
      'Параметры списка заявок заданы неверно.',
      false,
    );
  }
  if (!deps.candidateStore.listExecutiveRequests) {
    return sendError(
      reply,
      request,
      503,
      'executive_requests_unavailable',
      'Заявки временно недоступны.',
      true,
    );
  }
  try {
    return {
      data: deps.candidateStore.listExecutiveRequests(candidate.id, query.data),
      meta: { requestId: request.id },
    };
  } catch (reason) {
    if (reason instanceof Error && reason.message === 'executive_request_invalid_cursor') {
      return sendError(
        reply,
        request,
        400,
        'executive_request_cursor_invalid',
        'Обновите список заявок и повторите запрос.',
        false,
      );
    }
    throw reason;
  }
};

const handleGetExecutiveRequest: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const { requestId } = request.params as { requestId: string };
  if (!z.string().uuid().safeParse(requestId).success) {
    return sendError(
      reply,
      request,
      404,
      'executive_request_not_found',
      'Заявка не найдена.',
      false,
    );
  }
  if (!deps.candidateStore.getExecutiveRequest) {
    return sendError(
      reply,
      request,
      503,
      'executive_requests_unavailable',
      'Заявки временно недоступны.',
      true,
    );
  }
  const executiveRequest = deps.candidateStore.getExecutiveRequest(candidate.id, requestId);
  if (!executiveRequest) {
    return sendError(
      reply,
      request,
      404,
      'executive_request_not_found',
      'Заявка не найдена.',
      false,
    );
  }
  return { data: executiveRequest, meta: { requestId: request.id } };
};

const handleListExecutiveRequestQueue: Handler = async (deps, request, reply) => {
  if (!requireAdmin(deps, request, reply)) return undefined;
  const query = queueQuerySchema.safeParse(request.query ?? {});
  if (!query.success) {
    return sendError(
      reply,
      request,
      400,
      'executive_request_query_invalid',
      'Параметры списка заявок заданы неверно.',
      false,
    );
  }
  if (!deps.candidateStore.listExecutiveRequestQueue) {
    return sendError(
      reply,
      request,
      503,
      'executive_requests_unavailable',
      'Очередь заявок временно недоступна.',
      true,
    );
  }
  try {
    return {
      data: deps.candidateStore.listExecutiveRequestQueue(query.data),
      meta: { requestId: request.id },
    };
  } catch (reason) {
    if (reason instanceof Error && reason.message === 'executive_request_invalid_cursor') {
      return sendError(
        reply,
        request,
        400,
        'executive_request_cursor_invalid',
        'Обновите список заявок и повторите запрос.',
        false,
      );
    }
    throw reason;
  }
};

interface ExecutiveRequestStatusChange {
  readonly requestId: string;
  readonly status: ExecutiveRequestStatus;
}

function parseExecutiveRequestStatusChange(
  request: FastifyRequest,
  reply: FastifyReply,
): ExecutiveRequestStatusChange | null {
  const { requestId } = request.params as { requestId: string };
  if (!z.string().uuid().safeParse(requestId).success) {
    sendError(reply, request, 400, 'executive_request_id_invalid', 'Заявка не найдена.', false);
    return null;
  }
  const parsed = statusSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    sendError(
      reply,
      request,
      400,
      'executive_request_status_invalid',
      'Выберите доступный статус заявки.',
      false,
    );
    return null;
  }
  return { requestId, status: parsed.data.status };
}

const handleSetExecutiveRequestStatus: Handler = async (deps, request, reply) => {
  const principal = requireAdminMutation(deps, request, reply);
  if (!principal) return undefined;
  const change = parseExecutiveRequestStatusChange(request, reply);
  if (!change) return undefined;
  if (!deps.candidateStore.setExecutiveRequestStatus) {
    return sendError(
      reply,
      request,
      503,
      'executive_requests_unavailable',
      'Статус заявки временно не изменить.',
      true,
    );
  }
  return applyExecutiveRequestStatusChange(deps, request, reply, principal.userId, change);
};

async function applyExecutiveRequestStatusChange(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  actorUserId: string,
  change: ExecutiveRequestStatusChange,
): Promise<unknown> {
  try {
    const updated = deps.candidateStore.setExecutiveRequestStatus!(
      change.requestId,
      change.status,
      deps.config.executiveRequestCapacity ?? 0,
    );
    if (!updated) {
      return sendError(
        reply,
        request,
        404,
        'executive_request_not_found',
        'Заявка не найдена.',
        false,
      );
    }
    request.log.info(
      { executiveRequestId: change.requestId, actorUserId, status: updated.status },
      'executive_request_status_updated',
    );
    return { data: updated, meta: { requestId: request.id } };
  } catch (reason) {
    return sendExecutiveStatusError(request, reply, reason);
  }
}

function sendExecutiveStatusError(
  request: FastifyRequest,
  reply: FastifyReply,
  reason: unknown,
): unknown {
  if (reason instanceof ExecutiveRequestCapacityError) {
    return sendError(
      reply,
      request,
      409,
      'executive_request_capacity_reached',
      'Свободных мест на тарифе Executive сейчас нет.',
      false,
    );
  }
  if (reason instanceof ExecutiveRequestStatusTransitionError) {
    return sendError(
      reply,
      request,
      409,
      'executive_request_transition_invalid',
      'Изменить заявку из текущего статуса нельзя.',
      false,
    );
  }
  throw reason;
}

export function registerExecutiveRequestRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/executive-requests', withDeps(deps, handleListExecutiveRequests));
  app.get(
    '/api/v1/candidate/executive-requests/:requestId',
    withDeps(deps, handleGetExecutiveRequest),
  );
  app.post(
    '/api/v1/candidate/executive-requests',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    withDeps(deps, handleCreateExecutiveRequest),
  );
}

export function registerAdminExecutiveRequestRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/admin/executive-requests', withDeps(deps, handleListExecutiveRequestQueue));
  app.patch(
    '/api/v1/admin/executive-requests/:requestId',
    withDeps(deps, handleSetExecutiveRequestStatus),
  );
}
