import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { RouteDeps } from './deps';
import { requireAdmin, requireAdminMutation } from './adminAuth';
import { fieldMessages, sendError, withDeps } from './helpers';
import {
  adminLinkedinPoolParamsSchema,
  adminLinkedinRemoteLoginInputSchema,
  adminLinkedinRemoteLoginParamsSchema,
} from './schemas';
import {
  RemoteLoginError,
  type LinkedinRemoteLoginService,
  type RemoteLoginErrorCode,
} from '../linkedinPool/linkedinRemoteLogin';

/** Вход в браузере сервера (B373): только админ, один вход на аккаунт, кадры JSON/base64. */
const ERROR_STATUS: Readonly<Record<RemoteLoginErrorCode, number>> = {
  remote_login_not_found: 404,
  remote_login_already_active: 409,
  linkedin_profile_busy: 409,
  remote_login_closed: 409,
  remote_login_rate_limited: 429,
  remote_login_key_not_allowed: 422,
  remote_login_text_invalid: 422,
  remote_login_unavailable: 503,
};

const ERROR_MESSAGE: Readonly<Record<RemoteLoginErrorCode, string>> = {
  remote_login_not_found: 'Вход не найден или уже забыт сервером.',
  remote_login_already_active: 'Для этого аккаунта вход уже открыт.',
  linkedin_profile_busy: 'Профиль занят исполнителем; повторите через несколько минут.',
  remote_login_closed: 'Браузер входа уже закрыт.',
  remote_login_rate_limited: 'Слишком частые запросы к браузеру входа.',
  remote_login_key_not_allowed: 'Эта клавиша не разрешена.',
  remote_login_text_invalid: 'Текст пуст или длиннее 256 символов.',
  remote_login_unavailable: 'Браузер на сервере сейчас недоступен.',
};

type RemoteLoginDeps = RouteDeps;

function sendRemoteLoginError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof ZodError) {
    return sendError(reply, request, 422, 'validation_failed', 'Запрос не прошёл проверку.', false, fieldMessages(error));
  }
  if (error instanceof RemoteLoginError) {
    const status = ERROR_STATUS[error.code];
    return sendError(reply, request, status, error.code, ERROR_MESSAGE[error.code], status === 429 || status === 503);
  }
  return sendError(reply, request, 500, 'remote_login_failed', 'Вход в браузере сервера не выполнен.', true);
}

function serviceOrError(
  deps: RemoteLoginDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): LinkedinRemoteLoginService | null {
  if (deps.linkedinRemoteLogin && deps.linkedinPool) return deps.linkedinRemoteLogin;
  void sendError(reply, request, 503, 'remote_login_unavailable', ERROR_MESSAGE.remote_login_unavailable, true);
  return null;
}

async function handleStart(deps: RemoteLoginDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdminMutation(deps, request, reply);
  if (!principal) return;
  const service = serviceOrError(deps, request, reply);
  if (!service || !deps.linkedinPool) return;
  try {
    const { accountId } = adminLinkedinPoolParamsSchema.parse(request.params);
    const account = deps.linkedinPool.findAccount(accountId);
    if (!account) {
      return sendError(reply, request, 404, 'linkedin_account_not_found', 'Аккаунт LinkedIn не найден.', false);
    }
    if (['disabled', 'banned', 'revoked'].includes(account.state)) {
      return sendError(reply, request, 422, 'linkedin_account_not_loginable', 'В этот аккаунт войти нельзя.', false);
    }
    const started = await service.start(accountId, account.timezone, {
      actorUserId: principal.userId,
      actorUsername: principal.username,
    });
    return reply.code(201).send({ data: started, meta: { requestId: request.id } });
  } catch (error) {
    return sendRemoteLoginError(error, request, reply);
  }
}

async function handleFrame(deps: RemoteLoginDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const service = serviceOrError(deps, request, reply);
  if (!service) return;
  try {
    const { accountId, loginId } = adminLinkedinRemoteLoginParamsSchema.parse(request.params);
    const frame = service.frame(accountId, loginId);
    return reply
      .header('Cache-Control', 'no-store')
      .send({ data: frame, meta: { requestId: request.id } });
  } catch (error) {
    return sendRemoteLoginError(error, request, reply);
  }
}

async function handleInput(deps: RemoteLoginDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdminMutation(deps, request, reply);
  if (!principal) return;
  const service = serviceOrError(deps, request, reply);
  if (!service) return;
  try {
    const { accountId, loginId } = adminLinkedinRemoteLoginParamsSchema.parse(request.params);
    const input = adminLinkedinRemoteLoginInputSchema.parse(request.body ?? {});
    await service.input(accountId, loginId, input);
    return reply.code(204).send();
  } catch (error) {
    return sendRemoteLoginError(error, request, reply);
  }
}

async function handleClose(deps: RemoteLoginDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdminMutation(deps, request, reply);
  if (!principal) return;
  const service = serviceOrError(deps, request, reply);
  if (!service) return;
  try {
    const { accountId, loginId } = adminLinkedinRemoteLoginParamsSchema.parse(request.params);
    await service.close(accountId, loginId);
    return reply.code(204).send();
  } catch (error) {
    return sendRemoteLoginError(error, request, reply);
  }
}

export function registerLinkedinRemoteLoginRoutes(app: FastifyInstance, deps: RemoteLoginDeps): void {
  const base = '/api/v1/admin/linkedin/accounts/:accountId/remote-login';
  app.post(
    base,
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    withDeps(deps, handleStart),
  );
  app.get(`${base}/:loginId/frame`, withDeps(deps, handleFrame));
  app.post(`${base}/:loginId/input`, { bodyLimit: 4 * 1_024 }, withDeps(deps, handleInput));
  app.delete(`${base}/:loginId`, withDeps(deps, handleClose));
}
