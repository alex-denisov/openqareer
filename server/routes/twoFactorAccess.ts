import type { FastifyReply, FastifyRequest } from 'fastify';
import { TwoFactorStore } from '../auth/twoFactorStore';
import type { RouteDeps } from './deps';

const stores = new WeakMap<RouteDeps['config'], TwoFactorStore>();

/** Одно хранилище на конфигурацию приложения; закрывается вместе с ним. */
export function twoFactorStoreFor(deps: Pick<RouteDeps, 'config'>): TwoFactorStore {
  const existing = stores.get(deps.config);
  if (existing) return existing;
  const store = new TwoFactorStore({ databasePath: deps.config.databasePath, encryptionKey: deps.config.dataEncryptionKey });
  stores.set(deps.config, store);
  return store;
}

export function closeTwoFactorStoreFor(deps: Pick<RouteDeps, 'config'>): void {
  stores.get(deps.config)?.close();
  stores.delete(deps.config);
}

/**
 * B401: пароль верный, но у пользователя включена защита — выданная сессия снимается, вместо неё
 * вызов на код. Без защиты возвращает `null`, и вход идёт ровно как раньше.
 */
export function twoFactorLoginGate(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  authenticated: { readonly principal: { readonly userId: string }; readonly sessionToken: string },
  clientDeviceId: string | null,
): FastifyReply | null {
  const store = twoFactorStoreFor(deps);
  if (!store.isEnabled(authenticated.principal.userId)) return null;
  deps.authService.logout(authenticated.sessionToken);
  const challenge = store.createChallenge(authenticated.principal.userId, clientDeviceId, new Date());
  return reply.send({ data: { twoFactorRequired: true, challenge }, meta: { requestId: request.id } });
}
