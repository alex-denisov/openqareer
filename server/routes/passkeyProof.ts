import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthPrincipal } from '../auth/authTypes';
import type { RouteDeps } from './deps';
import { sendError } from './helpers';
import { twoFactorStoreFor } from './twoFactorAccess';

/** Пароль всегда; код второго фактора — когда защита включена. */
const proofSchema = z
  .object({
    password: z.string().min(1).max(256),
    code: z.string().trim().min(6).max(32).optional(),
  })
  .passthrough();

const LOCKED = 'Слишком много попыток. Попробуйте через 15 минут.';

const fail = (
  reply: FastifyReply,
  request: FastifyRequest,
  status: number,
  code: string,
  message: string,
): false => {
  sendError(reply, request, status, code, message, false);
  return false;
};

/**
 * B755: недавнее подтверждение перед добавлением или удалением ключа — пароль, а при включённой
 * двухфакторной защите ещё и код. Пароль проверяется первым: неверный пароль не тратит код.
 * `false` — отказ уже отправлен (не возвращать сам ответ: FastifyReply — thenable).
 */
export async function passkeyProven(
  deps: RouteDeps,
  principal: AuthPrincipal,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  const body = proofSchema.safeParse(request.body);
  if (!body.success)
    return fail(reply, request, 400, 'current_password_invalid', 'Введите пароль.');
  const factor = twoFactorStoreFor(deps);
  const now = new Date();
  if (factor.isLocked(principal.userId, now, 'session'))
    return fail(reply, request, 429, 'two_factor_locked', LOCKED);
  if (!(await deps.authService.passwordMatches?.(principal.userId, body.data.password))) {
    factor.noteFailure(principal.userId, now, 'session');
    return fail(reply, request, 400, 'current_password_invalid', 'Пароль указан неверно.');
  }
  if (!factor.isEnabled(principal.userId)) return true;
  if (!body.data.code)
    return fail(reply, request, 400, 'two_factor_invalid', 'Введите код из приложения.');
  const check = factor.verify(principal.userId, body.data.code, now, 'session');
  if (check === 'ok') return true;
  return check === 'locked'
    ? fail(reply, request, 429, 'two_factor_locked', LOCKED)
    : fail(reply, request, 400, 'two_factor_invalid', 'Код не подошёл.');
}
