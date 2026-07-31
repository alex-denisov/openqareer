import { timingSafeEqual } from 'node:crypto';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { z, ZodError } from 'zod';
import { COACH_PHASES } from './domain/coach';
import type {
  CandidateIdentity,
  CandidateStore,
} from './data/candidateStore';
import {
  CandidateNotFoundError,
  CandidateStoreConflictError,
} from './data/sqliteCandidateStore';
import {
  CoachProviderError,
  type CoachProvider,
} from './providers/coachProvider';
import type { ServerConfig } from './config';

interface BuildAppOptions {
  config: ServerConfig;
  coachProvider: CoachProvider;
  candidateStore: CandidateStore;
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
  candidateStore,
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

  app.post(
    '/api/v1/candidates',
    {
      preHandler: previewAuth(config.previewToken),
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 hour',
        },
      },
    },
    async (request, reply) => {
      const body = candidateCreateSchema.parse(request.body);
      const credentials = candidateStore.createCandidate(body);
      return reply.code(201).send({
        data: credentials,
        meta: { requestId: request.id },
      });
    },
  );

  app.get('/api/v1/candidate/me', async (request, reply) => {
    const candidate = authenticateCandidate(request, reply, candidateStore);
    if (!candidate) {
      return;
    }
    return {
      data: candidateStore.getSnapshot(candidate.id),
      meta: { requestId: request.id },
    };
  });

  app.get('/api/v1/candidate/export', async (request, reply) => {
    const candidate = authenticateCandidate(request, reply, candidateStore);
    if (!candidate) {
      return;
    }
    reply.header(
      'Content-Disposition',
      'attachment; filename="openqareer-candidate-export.json"',
    );
    return {
      data: candidateStore.exportCandidate(candidate.id),
      meta: {
        requestId: request.id,
        exportedAt: new Date().toISOString(),
      },
    };
  });

  app.delete('/api/v1/candidate/me', async (request, reply) => {
    const candidate = authenticateCandidate(request, reply, candidateStore);
    if (!candidate) {
      return;
    }
    candidateStore.deleteCandidate(candidate.id);
    return reply.code(204).send();
  });

  app.patch<{ Params: { memoryId: string } }>(
    '/api/v1/candidate/memory/:memoryId',
    async (request, reply) => {
      const candidate = authenticateCandidate(request, reply, candidateStore);
      if (!candidate) {
        return;
      }
      const memoryId = z.string().uuid().parse(request.params.memoryId);
      const change = memoryChangeSchema.parse(request.body);
      const memory = candidateStore.changeMemory(
        candidate.id,
        memoryId,
        change,
      );
      if (!memory && change.action !== 'delete') {
        return sendError(
          reply,
          request,
          404,
          'memory_not_found',
          'Элемент памяти не найден.',
          false,
        );
      }
      return {
        data: { memory, deleted: change.action === 'delete' },
        meta: { requestId: request.id },
      };
    },
  );

  app.post(
    '/api/v1/coach/turn',
    {
      handlerTimeout: 85_000,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const candidate = authenticateCandidate(request, reply, candidateStore);
      if (!candidate) {
        return;
      }
      const idempotencyKey = request.headers['idempotency-key'];
      const parsedIdempotencyKey = z.string().uuid().safeParse(idempotencyKey);
      if (!parsedIdempotencyKey.success) {
        return sendError(
          reply,
          request,
          400,
          'idempotency_key_required',
          'Передайте корректный Idempotency-Key.',
          false,
        );
      }

      const body = coachTurnRequestSchema.parse(request.body);
      const started = candidateStore.startTurn(
        candidate.id,
        parsedIdempotencyKey.data,
        body,
      );
      if (started.state === 'completed') {
        return providerResponse(request, started.output);
      }

      let output;
      try {
        output = await coachProvider.createTurn(
          started.input,
          parsedIdempotencyKey.data,
        );
        candidateStore.completeTurn(
          candidate.id,
          parsedIdempotencyKey.data,
          output,
        );
      } catch (error) {
        candidateStore.failTurn(
          candidate.id,
          parsedIdempotencyKey.data,
          error instanceof CoachProviderError
            ? error.code
            : 'internal_error',
        );
        throw error;
      }
      return providerResponse(request, output);
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
    if (error instanceof CandidateStoreConflictError) {
      return sendError(
        reply,
        request,
        409,
        'candidate_state_conflict',
        'Состояние кандидата изменилось. Обновите данные и повторите действие.',
        false,
      );
    }
    if (error instanceof CandidateNotFoundError) {
      return sendError(
        reply,
        request,
        404,
        'candidate_not_found',
        'Профиль кандидата не найден.',
        false,
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

const candidateCreateSchema = z.object({
  dataClass: z.enum(['synthetic', 'personal']).default('personal'),
  locale: z.enum(['ru-RU', 'en-US']).default('ru-RU'),
});

const coachTurnRequestSchema = z.object({
  messageId: z.string().uuid(),
  content: z.string().trim().min(1).max(8_000),
  phase: z.enum(COACH_PHASES).default('discovery'),
});

const memoryChangeSchema = z
  .object({
    action: z.enum(['confirm', 'correct', 'delete']),
    statement: z.string().trim().min(1).max(1_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.action === 'correct' && !value.statement) {
      context.addIssue({
        code: 'custom',
        path: ['statement'],
        message: 'statement is required for correction',
      });
    }
  });

function authenticateCandidate(
  request: FastifyRequest,
  reply: FastifyReply,
  candidateStore: CandidateStore,
): CandidateIdentity | null {
  const authorization = request.headers.authorization;
  const accessToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  const candidate = candidateStore.authenticate(accessToken);
  if (!candidate) {
    sendError(
      reply,
      request,
      401,
      'unauthorized',
      'Нужна действующая сессия кандидата.',
      false,
    );
    return null;
  }
  return candidate;
}

function providerResponse(
  request: FastifyRequest,
  output: Awaited<ReturnType<CoachProvider['createTurn']>>,
) {
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
