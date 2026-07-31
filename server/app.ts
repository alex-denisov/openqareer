import { timingSafeEqual } from 'node:crypto';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { ZodError } from 'zod';
import {
  coachTurnInputSchema,
  type CoachTurnInput,
} from './domain/coach';
import {
  CoachProviderError,
  type CoachProvider,
} from './providers/coachProvider';
import type { ServerConfig } from './config';

interface BuildAppOptions {
  config: ServerConfig;
  coachProvider: CoachProvider;
  serveStatic?: boolean;
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
  };
}

export async function buildApp({
  config,
  coachProvider,
  serveStatic = true,
}: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: '127.0.0.1',
    logger: {
      level: config.logLevel,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[REDACTED]',
      },
    },
    bodyLimit: 256 * 1_024,
    requestTimeout: 90_000,
  });

  await app.register(rateLimit, {
    global: false,
    keyGenerator: (request) => request.ip,
  });

  app.addHook('onSend', async (request, reply) => {
    if (request.url.startsWith('/api/')) {
      reply.header('Cache-Control', 'no-store');
    }
  });

  app.get('/health', async (_request, reply) => {
    reply.type('text/plain').header('Cache-Control', 'no-store');
    return config.release;
  });

  app.get('/api/v1/health', async () => ({
    data: {
      status: 'ok',
      release: config.release,
    },
  }));

  app.get(
    '/api/v1/provider/status',
    { preHandler: previewAuth(config.previewToken) },
    async (request) => ({
      data: {
        personalDataRoute: {
          provider: 'openai',
          model: config.model,
        },
        syntheticDataRoute: {
          provider: 'openrouter',
          model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        },
        qualityFloor: 'gpt-5.6-sol',
        ready: true,
      },
      meta: { requestId: request.id },
    }),
  );

  app.post<{ Body: CoachTurnInput }>(
    '/api/v1/coach/turn',
    {
      preHandler: previewAuth(config.previewToken),
      handlerTimeout: 85_000,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const idempotencyKey = request.headers['idempotency-key'];
      if (
        typeof idempotencyKey !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(idempotencyKey)
      ) {
        return sendError(
          reply,
          request,
          400,
          'idempotency_key_required',
          'Передайте корректный Idempotency-Key.',
          false,
        );
      }

      const input = coachTurnInputSchema.parse(request.body);
      const output = await coachProvider.createTurn(input, idempotencyKey);
      return {
        data: output.result,
        meta: {
          requestId: request.id,
          provider: output.provider,
          model: output.model,
          responseId: output.responseId,
          usage: output.usage,
        },
      };
    },
  );

  app.setErrorHandler((error, request, reply) => {
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
      return sendError(
        reply,
        request,
        error.statusCode,
        error.code,
        providerMessage(error.code),
        error.retryable,
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
  });

  if (serveStatic) {
    await app.register(fastifyStatic, {
      root: config.staticRoot,
      wildcard: false,
      globIgnore: ['server.mjs', 'health'],
      allowedPath: (pathName) =>
        pathName !== '/server.mjs' && pathName !== '/health',
    });

    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) {
        return sendError(
          reply,
          request,
          404,
          'route_not_found',
          'Такого API-маршрута нет.',
          false,
        );
      }
      if (request.method === 'GET') {
        return reply
          .header('Cache-Control', 'no-cache')
          .sendFile('index.html');
      }
      return sendError(
        reply,
        request,
        404,
        'route_not_found',
        'Такого маршрута нет.',
        false,
      );
    });
  } else {
    app.setNotFoundHandler((request, reply) =>
      sendError(
        reply,
        request,
        404,
        'route_not_found',
        'Такого API-маршрута нет.',
        false,
      ),
    );
  }

  return app;
}

function hasValidation(
  error: unknown,
): error is { validation: unknown[] } {
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

function previewAuth(expectedToken: string) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const authorization = request.headers.authorization;
    const suppliedToken = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (!secureEqual(suppliedToken, expectedToken)) {
      sendError(
        reply,
        request,
        401,
        'unauthorized',
        'Нужна действующая сессия.',
        false,
      );
    }
  };
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  code: string,
  message: string,
  retryable: boolean,
): FastifyReply {
  const body: ErrorBody = {
    error: {
      code,
      message,
      requestId: request.id,
      retryable,
    },
  };
  return reply.code(statusCode).send(body);
}

function providerMessage(code: CoachProviderError['code']): string {
  switch (code) {
    case 'provider_rate_limited':
      return 'Модель временно достигла лимита. Ответ кандидата сохраните и повторите позже.';
    case 'provider_budget_exhausted':
      return 'Бюджет приватной модели исчерпан. Ответ кандидата сохранён; администратору нужно пополнить лимит.';
    case 'provider_timeout':
      return 'Модель не ответила вовремя. Повторите запрос — ввод кандидата не нужно терять.';
    case 'provider_output_invalid':
      return 'Модель вернула неполную структуру. Данные кандидата не изменены.';
    case 'provider_unavailable':
      return 'Модель временно недоступна. Данные кандидата не изменены.';
  }
}
