import type { RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * Владелец (23.10, B557): лимиты частоты касаются только действий до входа.
 * Маршруты кандидата сохраняют свой лимит для запроса без действующей сессии
 * (ключ — IP), а вошедший пользователь проходит без счётчика: проверка сессии
 * та же, что у обработчика, поэтому поддельный токен лимит не снимает.
 * Вход, регистрация, сброс пароля и админка остаются на ключе по IP.
 */
export const SESSION_ROUTE_PREFIXES: readonly string[] = [
  '/api/v1/candidate/',
  '/api/v1/me/',
  '/api/v1/coach/',
  '/api/v1/vacancies/',
  '/api/v1/account/',
  '/api/v1/market/',
  '/api/v1/integrations/',
];

type SignedIn = (request: FastifyRequest) => boolean;

export interface RateLimitPolicyOptions {
  readonly isSignedIn: SignedIn;
}

function isSessionRoute(url: string): boolean {
  return SESSION_ROUTE_PREFIXES.some((prefix) => url.startsWith(prefix));
}

/** Чистая политика: возвращает новую настройку лимита маршрута, исходную не меняет. */
export function governRateLimit(
  url: string,
  rateLimit: RateLimitOptions | undefined,
  isSignedIn: SignedIn,
): RateLimitOptions | undefined {
  if (!rateLimit || !isSessionRoute(url)) return rateLimit;
  return { ...rateLimit, allowList: (request) => isSignedIn(request) };
}

/** Подключать до регистрации `@fastify/rate-limit`: тот читает настройки в своём `onRoute`. */
export function installRateLimitPolicy(
  app: FastifyInstance,
  options: RateLimitPolicyOptions,
): void {
  app.addHook('onRoute', (route) => {
    const config = route.config as { rateLimit?: RateLimitOptions } | undefined;
    const governed = governRateLimit(route.url, config?.rateLimit, options.isSignedIn);
    if (governed === config?.rateLimit) return;
    route.config = { ...config, rateLimit: governed };
  });
}
