import { createHash } from 'node:crypto';
import type { RateLimitOptions } from '@fastify/rate-limit';
import type { FastifyInstance, FastifyRequest, RouteOptions } from 'fastify';

/**
 * Лимитер ключевался по IP, а чтения кандидата имели часовые окна («120 в час»):
 * обычная работа с вкладкой «Компании и люди» (страницы, фильтры, поиск) упиралась
 * в потолок, и клиента блокировали на десятки минут. Здесь одна политика для всех
 * маршрутов кандидата:
 *  - ключ — IP плюс отпечаток сессии, чтобы аккаунты за одним адресом (в том числе
 *    за российским ретранслятором) не делили счётчик;
 *  - чтения получают минутное окно с запасом, а не часовое;
 *  - записи сохраняют своё строгое окно, меняется только ключ.
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

const UNIT_MS: Readonly<Record<string, number>> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
  day: 86_400_000,
};

/** Окно в миллисекундах; нераспознанное считается длинным, чтобы не оставить часовой потолок. */
function windowMs(timeWindow: RateLimitOptions['timeWindow']): number {
  if (typeof timeWindow === 'number') return timeWindow;
  const match = /^\s*(\d+)\s*(second|minute|hour|day)s?\s*$/i.exec(String(timeWindow ?? ''));
  return match ? Number(match[1]) * (UNIT_MS[match[2]!.toLowerCase()] ?? Infinity) : Infinity;
}

export const READ_RATE_LIMIT = { max: 300, timeWindow: '1 minute' } as const;

type KeyGenerator = (request: FastifyRequest) => string;

export interface RateLimitPolicyOptions {
  readonly tokenOf: (request: FastifyRequest) => string;
  readonly read?: { readonly max: number; readonly timeWindow: string };
}

function isReadOnly(method: RouteOptions['method']): boolean {
  const methods = Array.isArray(method) ? method : [method];
  return methods.every((entry) => entry === 'GET' || entry === 'HEAD');
}

function isSessionRoute(url: string): boolean {
  return SESSION_ROUTE_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export function sessionRateLimitKey(tokenOf: (request: FastifyRequest) => string): KeyGenerator {
  return (request) => {
    const token = tokenOf(request);
    if (!token) return request.ip;
    return `${request.ip}|${createHash('sha256').update(token).digest('base64url').slice(0, 24)}`;
  };
}

/** Чистая политика: возвращает новую настройку лимита маршрута, исходную не меняет. */
export function governRateLimit(
  method: RouteOptions['method'],
  url: string,
  rateLimit: RateLimitOptions | undefined,
  keyGenerator: KeyGenerator,
  read: { readonly max: number; readonly timeWindow: string } = READ_RATE_LIMIT,
): RateLimitOptions | undefined {
  if (!rateLimit || !isSessionRoute(url) || rateLimit.keyGenerator) return rateLimit;
  // Чтение с часовым окном — ошибка проектирования; короткие окна (скачивание файла) — сознательный предел.
  if (isReadOnly(method) && windowMs(rateLimit.timeWindow) >= UNIT_MS.hour!) {
    return { ...rateLimit, ...read, keyGenerator };
  }
  return { ...rateLimit, keyGenerator };
}

/** Подключать до регистрации `@fastify/rate-limit`: тот читает настройки в своём `onRoute`. */
export function installRateLimitPolicy(
  app: FastifyInstance,
  options: RateLimitPolicyOptions,
): void {
  const keyGenerator = sessionRateLimitKey(options.tokenOf);
  app.addHook('onRoute', (route) => {
    const config = route.config as { rateLimit?: RateLimitOptions } | undefined;
    const governed = governRateLimit(
      route.method,
      route.url,
      config?.rateLimit,
      keyGenerator,
      options.read,
    );
    if (governed === config?.rateLimit) return;
    route.config = { ...config, rateLimit: governed };
  });
}
