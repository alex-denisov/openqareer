import { existsSync } from 'node:fs';
import { join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { legalSlugFromPath } from '../../shared/legalRegistry';
import { CoachProviderError } from '../providers/coachProvider';
import { CandidateNotFoundError, CandidateStoreConflictError } from '../data/sqliteCandidateStore';
import {
  CareerCommandApprovalError,
  CareerCommandConflictError,
  CareerCommandNotFoundError,
} from '../data/sqliteCareerCommandRepository';
import { CareerCommandPolicyError } from '../orchestration/careerCommandPlanner';
import type { ServerConfig } from '../config';
import { sendError } from './helpers';
import { rateLimitMessage, retryAfterSeconds } from './rateLimitMessage';

const ADMIN_DOCUMENT = 'admin.html';

/**
 * Which prerendered document answers a deep link. Only surfaces that actually
 * have their own first paint are listed; anything else keeps the workspace
 * document, and a missing file falls back to it rather than 404ing a route
 * that used to work.
 */
function entryDocumentFor(url: string, staticRoot: string): string {
  const path = url.split('?')[0] ?? '';
  if (path === '/admin' || path.startsWith('/admin/')) {
    if (existsSync(join(staticRoot, ADMIN_DOCUMENT))) return ADMIN_DOCUMENT;
  }
  const legalSlug = legalSlugFromPath(path);
  if (legalSlug) {
    const document = `legal-${legalSlug}.html`;
    if (existsSync(join(staticRoot, document))) return document;
  }
  return 'index.html';
}

/**
 * Build output is not a route. `/assets/*` names a file this release either
 * published or did not, so a miss must say `404` and stop. Answering it with
 * the entry document handed the split-bundle loader an HTML page where a
 * bundle part belonged, and it dead-ended on `bad part length` (B168); the
 * same substitution broke root static files as INC-018.
 */
function isBuildAssetPath(url: string): boolean {
  const path = url.split('?')[0] ?? '';
  return path.startsWith('/assets/');
}

function hasValidation(error: unknown): error is { validation: unknown[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'validation' in error &&
    Array.isArray(error.validation)
  );
}

function getErrorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return undefined;
}

function getErrorStatusCode(error: unknown): number | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof error.statusCode === 'number'
  ) {
    return error.statusCode;
  }
  return undefined;
}

function providerMessage(code: CoachProviderError['code']): string {
  switch (code) {
    case 'provider_rate_limited':
      return 'Ответ сохранён. Модель временно достигла лимита — повторите этот ход позже.';
    case 'provider_budget_exhausted':
      return 'Ответ сохранён. Бюджет приватной модели исчерпан; администратору нужно пополнить лимит.';
    case 'provider_timeout':
      return 'Ответ сохранён. Модель не ответила вовремя — повторите этот ход.';
    case 'provider_output_invalid':
      return 'Ответ сохранён. Модель вернула неполную структуру — повторите этот ход.';
    case 'provider_unavailable':
      return 'Ответ сохранён. Модель временно недоступна — повторите этот ход позже.';
  }
}

interface MappedError {
  match(error: unknown): boolean;
  status: number;
  code: string;
  message: string;
}

const mappedErrors: MappedError[] = [
  {
    match: (e) =>
      e instanceof CandidateStoreConflictError || e instanceof CareerCommandConflictError,
    status: 409,
    code: 'candidate_state_conflict',
    message: 'Состояние кандидата изменилось. Обновите данные и повторите действие.',
  },
  {
    match: (e) => e instanceof CareerCommandApprovalError,
    status: 409,
    code: 'career_command_approval_invalid',
    message: 'Подтверждение не совпадает с командой или уже истекло.',
  },
  {
    match: (e) => e instanceof CareerCommandNotFoundError,
    status: 404,
    code: 'career_command_not_found',
    message: 'Карьерная команда не найдена.',
  },
  {
    match: (e) => e instanceof CandidateNotFoundError,
    status: 404,
    code: 'candidate_not_found',
    message: 'Профиль кандидата не найден.',
  },
];

function respondKnownError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply | null {
  if (error instanceof ZodError || hasValidation(error)) {
    return sendError(
      reply,
      request,
      422,
      'validation_failed',
      'Проверьте формат и длину переданных данных.',
      false,
    );
  }
  if (error instanceof CoachProviderError) {
    request.log.warn(
      {
        providerCode: error.code,
        providerDiagnostic: error.diagnostic,
        careerRole: error.role,
      },
      'coach-provider-request-failed',
    );
    return sendError(
      reply,
      request,
      error.statusCode,
      error.code,
      providerMessage(error.code),
      error.retryable,
    );
  }
  const mapped = mappedErrors.find((entry) => entry.match(error));
  if (mapped) {
    return sendError(reply, request, mapped.status, mapped.code, mapped.message, false);
  }
  if (error instanceof CareerCommandPolicyError) {
    return sendError(
      reply,
      request,
      error.code === 'invalid_approval' ? 409 : 422,
      `career_command_${error.code}`,
      'Предложение не прошло серверную policy-проверку.',
      false,
    );
  }
  return null;
}

function handleRouteError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  const known = respondKnownError(error, request, reply);
  if (known) return known;

  if (getErrorStatusCode(error) === 429) {
    // Срок берём у самого лимитера: окна маршрутов разные (15 минут на входе,
    // час на сбросе пароля), а прежняя константа «через минуту» звала повторять
    // раньше конца окна и получать тот же отказ (PRB-015).
    return sendError(
      reply,
      request,
      429,
      'rate_limit_exceeded',
      rateLimitMessage(retryAfterSeconds(reply.getHeader('retry-after'))),
      true,
    );
  }

  request.log.error(
    {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorCode: getErrorCode(error),
    },
    'request-failed',
  );
  return sendError(
    reply,
    request,
    500,
    'internal_error',
    'Сервис не завершил запрос. Повторите попытку позже.',
    true,
  );
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => handleRouteError(error, request, reply));
}

export async function registerStaticDelivery(
  app: FastifyInstance,
  config: ServerConfig,
  serveStatic: boolean,
): Promise<void> {
  if (serveStatic) {
    await app.register(fastifyStatic, {
      root: config.staticRoot,
      wildcard: false,
      globIgnore: ['server.mjs', 'health'],
      etag: false,
      lastModified: false,
      cacheControl: false,
      setHeaders: (reply, filePath) => {
        reply.header(
          'Cache-Control',
          filePath.endsWith('/index.html')
            ? 'no-store, max-age=0'
            : 'public, max-age=31536000, immutable',
        );
      },
      allowedPath: (pathName) => pathName !== '/server.mjs' && pathName !== '/health',
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return sendError(reply, request, 404, 'route_not_found', 'Такого API-маршрута нет.', false);
      }
      if (isBuildAssetPath(request.url)) {
        return sendError(
          reply,
          request,
          404,
          'asset_not_found',
          'Такого файла в этом релизе нет.',
          false,
        );
      }
      if (request.method === 'GET') {
        // Each surface has its own prerendered first paint. Serving the
        // workspace document on `/admin` left administrators looking at the
        // candidate cabinet for seconds while the bundle arrived (B089).
        return reply
          .header('Cache-Control', 'no-store, max-age=0')
          .sendFile(entryDocumentFor(request.url, config.staticRoot));
      }
      return sendError(reply, request, 404, 'route_not_found', 'Такого маршрута нет.', false);
    });
  } else {
    app.setNotFoundHandler((request, reply) =>
      sendError(reply, request, 404, 'route_not_found', 'Такого API-маршрута нет.', false),
    );
  }
}
