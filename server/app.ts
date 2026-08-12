import { timingSafeEqual } from 'node:crypto';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import { z, ZodError } from 'zod';
import type { CoachPhase, MarketObservation } from './domain/coach';
import { selectCoachPhase } from './orchestration/coachPhaseRouter';
import {
  CareerCommandPlanner,
  CareerCommandPolicyError,
} from './orchestration/careerCommandPlanner';
import { CareerCommandDispatcher } from './orchestration/careerCommandDispatcher';
import type { ConnectorExecutor } from './connectors/connectorHarness';
import {
  evaluateProductCase,
  evaluateWorkPreferences,
  productCaseSubmissionSchema,
  workPreferenceSubmissionSchema,
  type AssessmentId,
} from './domain/assessment';
import {
  evaluateGermanyMarket,
  germanyMarketSubmissionSchema,
} from './domain/germanyMarket';
import type {
  CandidateIdentity,
  CandidateStore,
} from './data/candidateStore';
import {
  CandidateNotFoundError,
  CandidateStoreConflictError,
} from './data/sqliteCandidateStore';
import {
  CareerCommandApprovalError,
  CareerCommandConflictError,
  CareerCommandNotFoundError,
} from './data/sqliteCareerCommandRepository';
import {
  CoachProviderError,
  type CoachProvider,
} from './providers/coachProvider';
import type { ServerConfig } from './config';
import {
  AuthUsernameTakenError,
  type AuthPrincipal,
  type SessionAuth,
} from './auth/authService';
import { CAREER_SUPER_PROMPT_REVISION } from './prompts/careerSuperPrompt';
import {
  searchHhVacancies,
  type HhVacancySample,
} from './connectors/hhVacancySearch';
import {
  importProfileUrl as importPublicProfileUrl,
  parseProfileUrl,
  type ProfileUrlImportResult,
} from './connectors/profileUrlImport';
import {
  CandidateOAuthService,
  OAuthConnectorError,
  type OAuthTransport,
} from './connectors/oauthConnector';
import { OfficialOAuthTransport } from './connectors/officialOAuthTransport';
import { OAUTH_PLATFORMS, type OAuthPlatform } from './connectors/oauthTypes';

interface BuildAppOptions {
  config: ServerConfig;
  coachProvider: CoachProvider;
  candidateStore: CandidateStore;
  authService: SessionAuth;
  serveStatic?: boolean;
  searchVacancies?: (input: {
    text: string;
    perPage?: number;
  }) => Promise<HhVacancySample>;
  importProfile?: (url: string) => Promise<ProfileUrlImportResult>;
  oauthTransport?: OAuthTransport;
  careerCommandExecutor?: ConnectorExecutor;
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
  authService,
  serveStatic = true,
  searchVacancies = searchHhVacancies,
  importProfile = importPublicProfileUrl,
  oauthTransport,
  careerCommandExecutor,
}: BuildAppOptions): Promise<FastifyInstance> {
  const oauthService = new CandidateOAuthService({
    store: candidateStore,
    providers: config.oauthProviders,
    transport: oauthTransport ?? new OfficialOAuthTransport(),
  });
  const careerCommandDispatcher = careerCommandExecutor
    ? new CareerCommandDispatcher({
        store: candidateStore,
        executor: careerCommandExecutor,
      })
    : null;
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
    requestTimeout: 190_000,
  });

  await app.register(cookie);
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
    async (request, reply) => {
      if (
        !hasPreviewAccess(request, config.previewToken) &&
        authenticateSession(request, authService, config)?.role !== 'admin'
      ) {
        return sendError(
          reply,
          request,
          401,
          'unauthorized',
          'Нужна сессия администратора.',
          false,
        );
      }
      return {
      data: {
        personalDataRoute: {
          provider: config.personalProvider ?? 'openai',
          model: config.model,
        },
        syntheticDataRoute: {
          provider: config.syntheticProvider ?? 'openrouter',
          model:
            config.syntheticModel ??
            'nvidia/nemotron-3-ultra-550b-a55b:free',
          fallbackProviders: (config.providerCatalogStatus ?? [])
            .filter(
              (provider) =>
                provider.configured &&
                provider.eligible &&
                provider.id !==
                  (config.syntheticProvider ?? 'openrouter'),
            )
            .map((provider) => provider.id),
          outputValidation: 'server-side-strict-schema',
        },
        qualityFloor: 'gpt-5.6-sol',
        promptRevision: CAREER_SUPER_PROMPT_REVISION,
        providers: config.providerCatalogStatus ?? [],
        ready: true,
      },
      meta: { requestId: request.id },
      };
    },
  );

  app.post(
    '/api/v1/auth/register',
    {
      config: { rateLimit: { max: 3, timeWindow: '30 minutes' } },
    },
    async (request, reply) => {
      if (!hasAllowedOrigin(request, config)) return csrfError(request, reply);
      const body = registrationSchema.parse(request.body);
      try {
        const authenticated = await authService.register(
          body.username,
          body.password,
          candidateStore,
        );
        setSessionCookie(reply, authenticated.sessionToken, config.secureCookies);
        return reply.code(201).send({
          data: publicPrincipal(authenticated.principal),
          meta: { requestId: request.id },
        });
      } catch (error) {
        if (error instanceof AuthUsernameTakenError) {
          return sendError(reply, request, 409, 'username_taken', 'Такой логин уже занят.', false);
        }
        throw error;
      }
    },
  );

  app.post(
    '/api/v1/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '15 minutes',
        },
      },
    },
    async (request, reply) => {
      if (!hasAllowedOrigin(request, config)) {
        return csrfError(request, reply);
      }
      const body = loginSchema.parse(request.body);
      const authenticated = await authService.login(
        body.username,
        body.password,
      );
      if (!authenticated) {
        return sendError(
          reply,
          request,
          401,
          'invalid_credentials',
          'Неверный логин или пароль.',
          false,
        );
      }
      setSessionCookie(
        reply,
        authenticated.sessionToken,
        config.secureCookies,
      );
      return {
        data: publicPrincipal(authenticated.principal),
        meta: { requestId: request.id },
      };
    },
  );

  app.get('/api/v1/auth/me', async (request, _reply) => {
    const principal = authenticateSession(request, authService, config);
    if (!principal) {
      return {
        data: null,
        meta: { requestId: request.id },
      };
    }
    return {
      data: publicPrincipal(principal),
      meta: { requestId: request.id },
    };
  });

  app.get(
    '/api/v1/market/hh',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '5 minutes',
        },
      },
    },
    async (request, reply) => {
      const query = hhMarketQuerySchema.parse(request.query);
      try {
        return {
          data: await searchVacancies({
            text: query.text,
            perPage: query.perPage,
          }),
          meta: { requestId: request.id },
        };
      } catch {
        return sendError(
          reply,
          request,
          502,
          'market_source_unavailable',
          'hh.ru не вернул выборку. Попробуйте позже или добавьте вакансию вручную.',
          true,
        );
      }
    },
  );

  app.post('/api/v1/auth/logout', async (request, reply) => {
    if (!hasAllowedOrigin(request, config)) {
      return csrfError(request, reply);
    }
    const sessionToken = request.cookies[sessionCookieName(config.secureCookies)];
    if (sessionToken) {
      authService.logout(sessionToken);
    }
    clearSessionCookie(reply, config.secureCookies);
    return reply.code(204).send();
  });

  app.post(
    '/api/v1/candidate/profile-imports',
    { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
      const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
      if (!candidate) return;
      const body = profileImportSchema.parse(request.body);
      return {
        data: await importProfile(body.url),
        meta: { requestId: request.id },
      };
    },
  );

  app.get('/api/v1/candidate/connections', async (request, reply) => {
    const candidate = authenticateCandidate(
      request,
      reply,
      candidateStore,
      authService,
      config,
    );
    if (!candidate) return;
    return {
      data: oauthService.listConnections(candidate.id),
      meta: { requestId: request.id },
    };
  });

  app.post<{ Params: { platform: string } }>(
    '/api/v1/candidate/connections/:platform/authorizations',
    { config: { rateLimit: { max: 10, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
      if (!candidate) return;
      const platform = parsePlatform(request.params.platform);
      if (!platform) return connectorNotFound(request, reply);
      try {
        return reply.code(201).send({
          data: oauthService.startAuthorization(candidate.id, platform),
          meta: { requestId: request.id },
        });
      } catch (error) {
        return sendConnectorError(request, reply, error);
      }
    },
  );

  app.get<{ Params: { platform: string } }>(
    '/api/v1/connectors/:platform/callback',
    { config: { rateLimit: { max: 20, timeWindow: '15 minutes' } } },
    async (request, reply) => {
      const platform = parsePlatform(request.params.platform);
      if (!platform) return connectorNotFound(request, reply);
      const callback = oauthCallbackQuerySchema.parse(request.query);
      if (callback.error) {
        oauthService.declineAuthorization(platform, callback.state);
        return connectionResultRedirect(reply, platform, 'declined');
      }
      try {
        await oauthService.completeAuthorization(platform, {
          state: callback.state,
          code: callback.code ?? '',
        });
      } catch (error) {
        request.log.warn(
          {
            platform,
            errorCode:
              error instanceof OAuthConnectorError
                ? error.code
                : 'internal_error',
          },
          'connector-callback-failed',
        );
        return connectionResultRedirect(
          reply,
          platform,
          'failed',
          error instanceof OAuthConnectorError
            ? error.code
            : 'provider_oauth_failed',
        );
      }
      return connectionResultRedirect(reply, platform, 'connected');
    },
  );

  app.delete<{ Params: { platform: string } }>(
    '/api/v1/candidate/connections/:platform',
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
      if (!candidate) return;
      const platform = parsePlatform(request.params.platform);
      if (!platform) return connectorNotFound(request, reply);
      return {
        data: await oauthService.disconnect(candidate.id, platform),
        meta: { requestId: request.id },
      };
    },
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
    const candidate = authenticateCandidate(
      request,
      reply,
      candidateStore,
      authService,
      config,
    );
    if (!candidate) {
      return;
    }
    return {
      data: candidateStore.getSnapshot(candidate.id),
      meta: { requestId: request.id },
    };
  });

  app.get('/api/v1/candidate/export', async (request, reply) => {
    const candidate = authenticateCandidate(
      request,
      reply,
      candidateStore,
      authService,
      config,
    );
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
    if (!hasSafeMutationOrigin(request, config)) {
      return csrfError(request, reply);
    }
    const candidate = authenticateCandidate(
      request,
      reply,
      candidateStore,
      authService,
      config,
    );
    if (!candidate) {
      return;
    }
    candidateStore.deleteCandidate(candidate.id);
    return reply.code(204).send();
  });

  app.patch<{ Params: { memoryId: string } }>(
    '/api/v1/candidate/memory/:memoryId',
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, config)) {
        return csrfError(request, reply);
      }
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
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

  app.post<{ Params: { assessmentId: string } }>(
    '/api/v1/candidate/assessments/:assessmentId',
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, config)) {
        return csrfError(request, reply);
      }
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
      if (!candidate) {
        return;
      }
      const assessmentId = assessmentIdSchema.parse(
        request.params.assessmentId,
      );
      const evaluated = evaluateAssessment(assessmentId, request.body);
      const assessment = candidateStore.saveAssessment(
        candidate.id,
        assessmentId,
        evaluated.submission,
        evaluated.result,
      );
      return {
        data: assessment,
        meta: { requestId: request.id },
      };
    },
  );

  app.post(
    '/api/v1/candidate/markets/DE',
    {
      config: {
        rateLimit: { max: 20, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, config)) {
        return csrfError(request, reply);
      }
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
      if (!candidate) return;
      const submission = germanyMarketSubmissionSchema.parse(request.body);
      const profile = candidateStore.saveGermanyMarket(
        candidate.id,
        submission,
        evaluateGermanyMarket(submission),
      );
      return {
        data: profile,
        meta: { requestId: request.id },
      };
    },
  );

  app.post(
    '/api/v1/coach/turn',
    {
      handlerTimeout: 180_000,
      config: {
        rateLimit: {
          max: 10,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, config)) {
        return csrfError(request, reply);
      }
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
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
      const phase = nextCoachPhase(
        candidateStore.getSnapshot(candidate.id),
        body.content,
      );
      const started = candidateStore.startTurn(
        candidate.id,
        parsedIdempotencyKey.data,
        { ...body, phase },
      );
      if (started.state === 'completed') {
        return providerResponse(request, started.output);
      }

      let marketObservations: MarketObservation[] = [];
      if (phase === 'market' && body.marketQuery) {
        try {
          marketObservations = marketObservationsFrom(
            await searchVacancies({ text: body.marketQuery, perPage: 12 }),
          );
        } catch {
          candidateStore.failTurn(
            candidate.id,
            parsedIdempotencyKey.data,
            'market_source_unavailable',
          );
          return sendError(
            reply,
            request,
            502,
            'market_source_unavailable',
            'hh.ru не вернул свежую выборку. Повторите позже.',
            true,
          );
        }
      }

      let output;
      try {
        output = await coachProvider.createTurn(
          { ...started.input, marketObservations },
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

  app.post(
    '/api/v1/candidate/career-commands',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, config)) {
        return csrfError(request, reply);
      }
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
      if (!candidate) return;
      const idempotencyKey = z
        .string()
        .uuid()
        .parse(request.headers['idempotency-key']);
      const body = careerCommandRequestSchema.parse(request.body);
      const snapshot = candidateStore.getSnapshot(candidate.id);
      const turn = snapshot.turns.find(
        (item) =>
          item.idempotencyKey === body.turnIdempotencyKey &&
          item.status === 'completed' &&
          item.result,
      );
      const proposal = turn?.result?.actionProposals[body.proposalIndex];
      if (!turn || !proposal) {
        return sendError(
          reply,
          request,
          404,
          'career_proposal_not_found',
          'Такого предложения нет в сохранённом карьерном ходе.',
          false,
        );
      }
      const planner = new CareerCommandPlanner({
        createId: () => idempotencyKey,
      });
      const command = candidateStore.saveCareerCommand(
        planner.materialize({
          principal: { candidateId: candidate.id },
          proposal,
          availableEvidenceRefs: new Set(
            snapshot.messages
              .filter((message) => message.role === 'user')
              .map((message) => message.id),
          ),
          strategyDecisionId: turn.idempotencyKey,
          modelInvocationIds: turn.provenance
            ? [turn.provenance.responseId]
            : [],
          idempotencyKey,
          approval: null,
        }),
      );
      return reply.code(201).send({
        data: command,
        meta: { requestId: request.id },
      });
    },
  );

  app.get(
    '/api/v1/candidate/career-commands/:commandId',
    async (request, reply) => {
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
      if (!candidate) return;
      const { commandId } = careerCommandParamsSchema.parse(request.params);
      const command = candidateStore.getCareerCommand(candidate.id, commandId);
      if (!command) throw new CareerCommandNotFoundError();
      return { data: command, meta: { requestId: request.id } };
    },
  );

  app.post(
    '/api/v1/candidate/career-commands/:commandId/approvals',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      if (!hasSafeMutationOrigin(request, config)) {
        return csrfError(request, reply);
      }
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
      if (!candidate) return;
      const { commandId } = careerCommandParamsSchema.parse(request.params);
      const approvalId = z
        .string()
        .uuid()
        .parse(request.headers['idempotency-key']);
      const command = candidateStore.getCareerCommand(candidate.id, commandId);
      if (!command) throw new CareerCommandNotFoundError();
      const consumedAt = new Date();
      let approved = candidateStore.approveCareerCommand({
        candidateId: candidate.id,
        commandId,
        approval: {
          id: approvalId,
          candidateId: candidate.id,
          commandId,
          capability: command.capability,
          expiresAt: new Date(consumedAt.getTime() + 5 * 60_000).toISOString(),
        },
        consumedAt: consumedAt.toISOString(),
      });
      if (careerCommandDispatcher && approved.status === 'queued') {
        approved = await careerCommandDispatcher.dispatch(
          candidate.id,
          commandId,
        );
      }
      return {
        data: approved,
        meta: { requestId: request.id },
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
    if (
      error instanceof CandidateStoreConflictError ||
      error instanceof CareerCommandConflictError
    ) {
      return sendError(
        reply,
        request,
        409,
        'candidate_state_conflict',
        'Состояние кандидата изменилось. Обновите данные и повторите действие.',
        false,
      );
    }
    if (error instanceof CareerCommandApprovalError) {
      return sendError(
        reply,
        request,
        409,
        'career_command_approval_invalid',
        'Подтверждение не совпадает с командой или уже истекло.',
        false,
      );
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
    if (error instanceof CareerCommandNotFoundError) {
      return sendError(
        reply,
        request,
        404,
        'career_command_not_found',
        'Карьерная команда не найдена.',
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
          .header('Cache-Control', 'no-store, max-age=0')
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

const hhMarketQuerySchema = z.object({
  text: z.string().trim().min(2).max(200),
  perPage: z.coerce.number().int().min(1).max(20).default(12),
});

const loginSchema = z.object({
  username: z.string().trim().min(3).max(80),
  password: z.string().min(1).max(256),
});

const registrationSchema = z.object({
  username: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/),
  password: z.string().min(12).max(256),
});

const profileImportSchema = z.object({
  url: z
    .string()
    .trim()
    .url()
    .max(2_048)
    .refine((value) => {
      try {
        parseProfileUrl(value);
        return true;
      } catch {
        return false;
      }
    }),
});

const oauthCallbackQuerySchema = z
  .object({
    state: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32,256}$/),
    code: z.string().min(8).max(2_048).optional(),
    error: z.string().max(200).optional(),
  })
  .refine((value) => Boolean(value.code) !== Boolean(value.error));

function parsePlatform(value: string): OAuthPlatform | null {
  return (OAUTH_PLATFORMS as readonly string[]).includes(value)
    ? (value as OAuthPlatform)
    : null;
}

function connectorNotFound(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  return sendError(
    reply,
    request,
    404,
    'connector_not_found',
    'Такая площадка не подключается.',
    false,
  );
}

function sendConnectorError(
  request: FastifyRequest,
  reply: FastifyReply,
  error: unknown,
): FastifyReply {
  if (!(error instanceof OAuthConnectorError)) throw error;
  return sendError(
    reply,
    request,
    error.statusCode,
    error.code,
    connectorMessage(error.code),
    error.retryable,
  );
}

function connectorMessage(code: OAuthConnectorError['code']): string {
  switch (code) {
    case 'connector_not_configured':
      return 'Подключение этой площадки ещё не настроено администратором.';
    case 'oauth_state_invalid':
      return 'Ссылка подключения истекла или уже использована. Начните подключение заново.';
    case 'provider_oauth_failed':
      return 'Площадка не подтвердила доступ. Повторите подключение позже.';
    case 'provider_profile_unavailable':
      return 'Площадка не вернула профиль по выданному доступу.';
  }
}

/**
 * The callback is opened by the platform authorization server in the
 * candidate's browser, so the outcome is always handed to a fixed same-origin
 * route. A caller-provided return URL is never accepted.
 */
function connectionResultRedirect(
  reply: FastifyReply,
  platform: OAuthPlatform,
  status: 'connected' | 'declined' | 'failed',
  reason?: OAuthConnectorError['code'],
): FastifyReply {
  const query = new URLSearchParams({ platform, status });
  if (reason) query.set('reason', reason);
  return reply.redirect(`/connections/result?${query.toString()}`, 303);
}

const coachTurnRequestSchema = z.object({
  messageId: z.string().uuid(),
  content: z.string().trim().min(1).max(8_000),
  marketQuery: z.string().trim().min(2).max(200).optional(),
});

function marketObservationsFrom(sample: HhVacancySample) {
  return sample.items.map((item) => ({
    ref: `market:hh:${item.id}`,
    source: sample.source,
    title: item.title,
    company: item.company,
    location: item.location,
    sourceUrl: item.sourceUrl,
    observedAt: sample.fetchedAt,
  }));
}

const careerCommandRequestSchema = z.object({
  turnIdempotencyKey: z.string().uuid(),
  proposalIndex: z.number().int().min(0).max(19),
});

const careerCommandParamsSchema = z.object({
  commandId: z.string().uuid(),
});

function nextCoachPhase(
  snapshot: ReturnType<CandidateStore['getSnapshot']>,
  content: string,
): CoachPhase {
  const latestCompleted = [...snapshot.turns]
    .reverse()
    .find((turn) => turn.status === 'completed' && turn.result);
  return selectCoachPhase({
    content,
    previousPhase: latestCompleted?.result?.phase ?? null,
  });
}

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

const assessmentIdSchema = z.enum([
  'work-preferences-v1',
  'product-case-v1',
]);

function evaluateAssessment(assessmentId: AssessmentId, body: unknown) {
  if (assessmentId === 'work-preferences-v1') {
    const submission = workPreferenceSubmissionSchema.parse(body);
    return { submission, result: evaluateWorkPreferences(submission) };
  }
  const submission = productCaseSubmissionSchema.parse(body);
  return { submission, result: evaluateProductCase(submission) };
}

function authenticateCandidate(
  request: FastifyRequest,
  reply: FastifyReply,
  candidateStore: CandidateStore,
  authService: SessionAuth,
  config: ServerConfig,
): CandidateIdentity | null {
  const authorization = request.headers.authorization;
  const accessToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  const bearerCandidate = candidateStore.authenticate(accessToken);
  const sessionCandidate =
    authenticateSession(request, authService, config)?.candidate ?? null;
  const candidate = bearerCandidate ?? sessionCandidate;
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

function authenticateSession(
  request: FastifyRequest,
  authService: SessionAuth,
  config: ServerConfig,
): AuthPrincipal | null {
  const sessionToken =
    request.cookies[sessionCookieName(config.secureCookies)] ?? '';
  return authService.authenticate(sessionToken);
}

function hasPreviewAccess(
  request: FastifyRequest,
  expectedToken: string,
): boolean {
  const authorization = request.headers.authorization;
  const suppliedToken = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : '';
  return secureEqual(suppliedToken, expectedToken);
}

function hasAllowedOrigin(
  request: FastifyRequest,
  config: ServerConfig,
): boolean {
  return (
    typeof request.headers.origin === 'string' &&
    config.allowedOrigins.includes(request.headers.origin)
  );
}

function hasSafeMutationOrigin(
  request: FastifyRequest,
  config: ServerConfig,
): boolean {
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer oqc_')) {
    return true;
  }
  return hasAllowedOrigin(request, config);
}

function csrfError(
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  return sendError(
    reply,
    request,
    403,
    'origin_not_allowed',
    'Запрос отклонён: источник страницы не подтверждён.',
    false,
  );
}

function setSessionCookie(
  reply: FastifyReply,
  sessionToken: string,
  secure: boolean,
): void {
  reply.setCookie(sessionCookieName(secure), sessionToken, {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: 12 * 60 * 60,
  });
}

function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(sessionCookieName(secure), {
    path: '/',
    httpOnly: true,
    secure,
    sameSite: 'strict',
  });
}

function sessionCookieName(secure: boolean): string {
  return secure
    ? '__Host-openqareer_session'
    : 'openqareer_session';
}

function publicPrincipal(principal: AuthPrincipal) {
  return {
    username: principal.username,
    role: principal.role,
    isTest: principal.isTest,
    candidateId: principal.candidate?.id ?? null,
  };
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
      routing: output.routing,
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
