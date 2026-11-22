import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { otpauthUrl } from '../auth/totp';
import type { TwoFactorCheck } from '../auth/twoFactorStore';
import type { AuthPrincipal } from '../auth/authTypes';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { csrfError, hasAllowedOrigin, publicPrincipal, sendError, withDeps } from './helpers';
import { startSession } from './sessionDevice';
import { closeTwoFactorStoreFor, twoFactorStoreFor } from './twoFactorAccess';

const code = z.string().trim().min(6).max(32);
const loginStepSchema = z.object({ challenge: z.string().max(200), code }).strict();
/** Включение — с паролем: по чужой сессии защиту не включить и владельца не запереть. */
const enableSchema = z.object({ code, password: z.string().min(1).max(256) }).strict();
/** Код или пароль: потерявший телефон отключает защиту паролем. */
const proofSchema = z
  .object({ code: code.optional(), password: z.string().min(1).max(256).optional() })
  .strict()
  .refine((value) => Boolean(value.code) !== Boolean(value.password));

/** B401: из сессии «войти как кандидат» защита входа и пароль не меняются. */
export const IMPERSONATED_CODE = 'impersonated_session';
export const IMPERSONATED_MESSAGE = 'Это может сделать только сам кандидат.';

const LOCKED = 'Слишком много попыток. Попробуйте через 15 минут.';
export const answer = (request: FastifyRequest, data: unknown) => ({ data, meta: { requestId: request.id } });

function refuseCheck(reply: FastifyReply, request: FastifyRequest, check: Exclude<TwoFactorCheck, 'ok'>) {
  return check === 'locked'
    ? sendError(reply, request, 429, 'two_factor_locked', LOCKED, false)
    : sendError(reply, request, 400, 'two_factor_invalid', 'Код не подошёл.', false);
}

/** Второй шаг входа: вызов из первого шага и код. Сессия — только после верного кода. */
async function postLoginStep(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasAllowedOrigin(request, deps.config)) return csrfError(request, reply);
  const body = loginStepSchema.safeParse(request.body);
  if (!body.success) return sendError(reply, request, 400, 'two_factor_invalid', 'Код не подошёл.', false);
  const store = twoFactorStoreFor(deps);
  const now = new Date();
  const challenge = store.readChallenge(body.data.challenge, now);
  if (!challenge) return sendError(reply, request, 401, 'two_factor_challenge_expired', 'Войдите заново.', false);
  const check = store.verify(challenge.userId, body.data.code, now, 'login');
  if (check !== 'ok') {
    store.failChallenge(body.data.challenge);
    return refuseCheck(reply, request, check);
  }
  store.consumeChallenge(body.data.challenge);
  const authenticated = deps.authService.issueSessionForUser?.(challenge.userId, challenge.clientDeviceId ?? undefined) ?? null;
  if (!authenticated) return sendError(reply, request, 401, 'two_factor_challenge_expired', 'Войдите заново.', false);
  startSession(deps, request, reply, authenticated.sessionToken);
  return answer(request, { ...publicPrincipal(authenticated.principal, deps.config), sessionToken: authenticated.sessionToken });
}

export type AccountHandler = (deps: RouteDeps, principal: AuthPrincipal, request: FastifyRequest, reply: FastifyReply) => unknown;

export function account(deps: RouteDeps, handler: AccountHandler, changesProtection = false) {
  return withDeps(deps, async (routeDeps, request, reply) => {
    const principal = requireCabinetB640(request, reply, routeDeps);
    if (!principal) return reply;
    reply.header('Cache-Control', 'no-store');
    // Администратор вошёл своей сессией и своей 2FA: защиту кандидата он не меняет.
    if (changesProtection && principal.impersonatedBy) {
      return sendError(reply, request, 403, IMPERSONATED_CODE, IMPERSONATED_MESSAGE, false);
    }
    return handler(routeDeps, principal, request, reply);
  });
}

const getStatus: AccountHandler = (deps, principal, request) =>
  answer(request, twoFactorStoreFor(deps).status(principal.userId));

const postSetup: AccountHandler = (deps, principal, request, reply) => {
  const store = twoFactorStoreFor(deps);
  if (store.isEnabled(principal.userId)) {
    return sendError(reply, request, 409, 'two_factor_already_enabled', 'Двухфакторная защита уже включена.', false);
  }
  const secret = store.beginSetup(principal.userId, new Date());
  return answer(request, { secret, otpauthUrl: otpauthUrl(secret, principal.email ?? principal.username) });
};

const postEnable: AccountHandler = async (deps, principal, request, reply) => {
  const body = enableSchema.safeParse(request.body);
  if (!body.success) return refuseCheck(reply, request, 'invalid');
  const store = twoFactorStoreFor(deps);
  const now = new Date();
  // Сначала — начато ли подключение: без строки защиты неверный пароль некуда считать.
  if (!store.hasPendingSetup(principal.userId)) {
    return sendError(reply, request, 409, 'two_factor_setup_missing', 'Начните подключение заново.', false);
  }
  if (store.isLocked(principal.userId, now, 'session')) return refuseCheck(reply, request, 'locked');
  if (!(await deps.authService.passwordMatches?.(principal.userId, body.data.password))) {
    store.noteFailure(principal.userId, now, 'session');
    return sendError(reply, request, 400, 'current_password_invalid', 'Пароль указан неверно.', false);
  }
  const result = store.confirmSetup(principal.userId, body.data.code, now);
  if (result.status === 'enabled') return answer(request, { enabled: true, backupCodes: result.backupCodes });
  if (result.status === 'no_setup') {
    return sendError(reply, request, 409, 'two_factor_setup_missing', 'Начните подключение заново.', false);
  }
  return refuseCheck(reply, request, result.status);
};

/**
 * Подтверждение кодом или паролем; неверный пароль считается попыткой так же, как код.
 * `false` — отказ уже отправлен. Не возвращать сам ответ: FastifyReply — thenable, и `await`
 * превратил бы отказ в `undefined`, то есть в «подтверждено».
 */
async function proven(deps: RouteDeps, principal: AuthPrincipal, request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const body = proofSchema.safeParse(request.body);
  if (!body.success) return refused(refuseCheck(reply, request, 'invalid'));
  const store = twoFactorStoreFor(deps);
  if (!store.isEnabled(principal.userId)) {
    return refused(sendError(reply, request, 409, 'two_factor_not_enabled', 'Двухфакторная защита выключена.', false));
  }
  const now = new Date();
  if (body.data.code) {
    const check = store.verify(principal.userId, body.data.code, now, 'session');
    return check === 'ok' || refused(refuseCheck(reply, request, check));
  }
  if (store.isLocked(principal.userId, now, 'session')) return refused(refuseCheck(reply, request, 'locked'));
  if (await deps.authService.passwordMatches?.(principal.userId, body.data.password as string)) return true;
  store.noteFailure(principal.userId, now, 'session');
  return refused(sendError(reply, request, 400, 'current_password_invalid', 'Пароль указан неверно.', false));
}

const refused = (_sent: FastifyReply): false => false;

const postDisable: AccountHandler = async (deps, principal, request, reply) => {
  if (!(await proven(deps, principal, request, reply))) return reply;
  twoFactorStoreFor(deps).disable(principal.userId);
  return answer(request, { enabled: false, backupCodesLeft: 0 });
};

const postBackupCodes: AccountHandler = async (deps, principal, request, reply) => {
  if (!(await proven(deps, principal, request, reply))) return reply;
  return answer(request, { backupCodes: twoFactorStoreFor(deps).regenerateBackupCodes(principal.userId) });
};

/** B401: двухфакторная защита — шаг входа (до входа, с лимитом) и настройки в «Вход и безопасность» (за флагом B640). */
export function registerTwoFactorRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.addHook('onClose', async () => closeTwoFactorStoreFor(deps));
  app.post(
    '/api/v1/auth/login/two-factor',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    withDeps(deps, postLoginStep),
  );
  const base = '/api/v1/account/two-factor';
  app.get(base, account(deps, getStatus));
  app.post(`${base}/setup`, account(deps, postSetup, true));
  app.post(`${base}/enable`, account(deps, postEnable, true));
  app.post(`${base}/disable`, account(deps, postDisable, true));
  app.post(`${base}/backup-codes`, account(deps, postBackupCodes, true));
}
