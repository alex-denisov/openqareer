import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { RouteDeps } from './deps';
import { requireAdmin, requireAdminMutation } from './adminAuth';
import { sendError, withDeps } from './helpers';
import {
  adminLinkedinPoolCompleteSchema,
  adminLinkedinPoolCreateSchema,
  adminLinkedinPoolDeleteSchema,
  adminLinkedinPoolParamsSchema,
  adminLinkedinPoolPatchSchema,
  adminLinkedinPoolQuerySchema,
} from './schemas';
import {
  LinkedinPoolConflictError,
  LinkedinPoolNotFoundError,
  type SqliteLinkedinPoolRepository,
} from '../linkedinPool/sqliteLinkedinPoolRepository';

type LinkedinPoolDeps = RouteDeps & {
  linkedinPool?: SqliteLinkedinPoolRepository;
};

function repositoryOrError(
  deps: LinkedinPoolDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): SqliteLinkedinPoolRepository | null {
  if (deps.linkedinPool) return deps.linkedinPool;
  void sendError(
    reply,
    request,
    503,
    'linkedin_pool_unavailable',
    'Реестр LinkedIn временно недоступен.',
    true,
  );
  return null;
}
function idempotencyKey(request: FastifyRequest): string | null {
  const value = request.headers['idempotency-key'];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function sendRepositoryError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof LinkedinPoolNotFoundError) {
    return sendError(
      reply,
      request,
      404,
      'linkedin_account_not_found',
      'Аккаунт LinkedIn не найден.',
      false,
    );
  }
  if (error instanceof LinkedinPoolConflictError) {
    const code = error.message;
    const status = code === 'stale_revision' ? 409 : 422;
    return sendError(
      reply,
      request,
      status,
      code,
      'Операция над аккаунтом LinkedIn не выполнена.',
      false,
    );
  }
  return sendError(
    reply,
    request,
    500,
    'linkedin_pool_operation_failed',
    'Операция над аккаунтом LinkedIn не выполнена.',
    true,
  );
}

async function handleList(deps: LinkedinPoolDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const repository = repositoryOrError(deps, request, reply);
  if (!repository) return;
  const query = adminLinkedinPoolQuerySchema.parse(request.query ?? {});
  return { data: repository.list(query), meta: { requestId: request.id } };
}

async function handleCreate(deps: LinkedinPoolDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdminMutation(deps, request, reply);
  if (!principal) return;
  const repository = repositoryOrError(deps, request, reply);
  if (!repository) return;
  const key = idempotencyKey(request);
  if (!key)
    return sendError(
      reply,
      request,
      422,
      'idempotency_key_required',
      'Повторяемый запрос требует Idempotency-Key.',
      false,
    );
  const body = adminLinkedinPoolCreateSchema.parse(request.body ?? {});
  try {
    const result = repository.create({
      ...body,
      idempotencyKey: key,
      actorUserId: principal.userId,
      actorUsername: principal.username,
    });
    return reply
      .code(result.created ? 201 : 200)
      .send({ data: result.account, meta: { requestId: request.id } });
  } catch (error) {
    return sendRepositoryError(error, request, reply);
  }
}

async function handlePatch(deps: LinkedinPoolDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdminMutation(deps, request, reply);
  if (!principal) return;
  const repository = repositoryOrError(deps, request, reply);
  if (!repository) return;
  const params = adminLinkedinPoolParamsSchema.parse(request.params);
  const body = adminLinkedinPoolPatchSchema.parse(request.body ?? {});
  try {
    return {
      data: repository.update({
        ...params,
        ...body,
        actorUserId: principal.userId,
        actorUsername: principal.username,
      }),
      meta: { requestId: request.id },
    };
  } catch (error) {
    return sendRepositoryError(error, request, reply);
  }
}

async function handleLogin(deps: LinkedinPoolDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdminMutation(deps, request, reply);
  if (!principal) return;
  const repository = repositoryOrError(deps, request, reply);
  if (!repository) return;
  const { accountId } = adminLinkedinPoolParamsSchema.parse(request.params);
  try {
    const result = await repository.beginLogin(accountId, {
      actorUserId: principal.userId,
      actorUsername: principal.username,
    });
    return reply.code(202).send({ data: result, meta: { requestId: request.id } });
  } catch (error) {
    return sendRepositoryError(error, request, reply);
  }
}

async function handleComplete(
  deps: LinkedinPoolDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const principal = requireAdminMutation(deps, request, reply);
  if (!principal) return;
  const repository = repositoryOrError(deps, request, reply);
  if (!repository) return;
  const { accountId } = adminLinkedinPoolParamsSchema.parse(request.params);
  const body = adminLinkedinPoolCompleteSchema.parse(request.body ?? {});
  try {
    return {
      data: await repository.completeLogin(accountId, body.handle, {
        state: body.state,
        ...(body.accountMarker ? { accountMarker: body.accountMarker } : {}),
      }),
      meta: { requestId: request.id },
    };
  } catch (error) {
    return sendRepositoryError(error, request, reply);
  }
}

async function handleProbe(deps: LinkedinPoolDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdminMutation(deps, request, reply);
  if (!principal) return;
  const repository = repositoryOrError(deps, request, reply);
  if (!repository) return;
  const { accountId } = adminLinkedinPoolParamsSchema.parse(request.params);
  try {
    return {
      data: await repository.probeAccount(accountId, {
        actorUserId: principal.userId,
        actorUsername: principal.username,
      }),
      meta: { requestId: request.id },
    };
  } catch (error) {
    return sendRepositoryError(error, request, reply);
  }
}

async function handleRevoke(deps: LinkedinPoolDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdminMutation(deps, request, reply);
  if (!principal) return;
  const repository = repositoryOrError(deps, request, reply);
  if (!repository) return;
  const { accountId } = adminLinkedinPoolParamsSchema.parse(request.params);
  try {
    return {
      data: repository.revoke(accountId, {
        actorUserId: principal.userId,
        actorUsername: principal.username,
      }),
      meta: { requestId: request.id },
    };
  } catch (error) {
    return sendRepositoryError(error, request, reply);
  }
}

async function handleDelete(deps: LinkedinPoolDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdminMutation(deps, request, reply);
  if (!principal) return;
  const repository = repositoryOrError(deps, request, reply);
  if (!repository) return;
  const { accountId } = adminLinkedinPoolParamsSchema.parse(request.params);
  const body = adminLinkedinPoolDeleteSchema.parse(request.body ?? {});
  try {
    repository.delete(accountId, body.revision, {
      actorUserId: principal.userId,
      actorUsername: principal.username,
    });
    return reply.code(204).send();
  } catch (error) {
    return sendRepositoryError(error, request, reply);
  }
}

export function registerLinkedinPoolRoutes(app: FastifyInstance, deps: LinkedinPoolDeps): void {
  app.get('/api/v1/admin/linkedin/accounts', withDeps(deps, handleList));
  app.post('/api/v1/admin/linkedin/accounts', withDeps(deps, handleCreate));
  app.patch('/api/v1/admin/linkedin/accounts/:accountId', withDeps(deps, handlePatch));
  app.post('/api/v1/admin/linkedin/accounts/:accountId/session', withDeps(deps, handleLogin));
  app.post(
    '/api/v1/admin/linkedin/accounts/:accountId/session/complete',
    withDeps(deps, handleComplete),
  );
  app.post('/api/v1/admin/linkedin/accounts/:accountId/probe', withDeps(deps, handleProbe));
  app.post('/api/v1/admin/linkedin/accounts/:accountId/revoke', withDeps(deps, handleRevoke));
  app.delete('/api/v1/admin/linkedin/accounts/:accountId', withDeps(deps, handleDelete));
}
