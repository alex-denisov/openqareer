import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
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
  hhApplicationExecutionTargetSchema,
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
import {
  buildResumeStudioProjection,
  validateResumeEvidenceFreshness,
  type ResumeEvidenceFreshness,
  type ResumeStudioProjection,
} from './domain/resumeStudio';
import {
  resumeDraftSchema,
  EMPTY_RESUME_DRAFT,
  type ResumeDraft,
} from './domain/resumeDraft';
import type {
  CandidateIdentity,
  CandidateStore,
} from './data/candidateStore';
import {
  CandidateDocumentRetentionError,
  CandidateNotFoundError,
  CandidateStoreConflictError,
} from './data/sqliteCandidateStore';
import {
  CandidateDocumentValidationError,
  CandidateDocumentVersionError,
} from './data/sqliteDocumentRepository';
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
  deriveUsernameFromEmail,
  getEmailError,
  getNameError,
  getPasswordError,
} from '../shared/accountValidation';
import {
  AuthEmailTakenError,
  AuthInvalidPasswordError,
  AuthInvalidResetTokenError,
  AuthUsernameTakenError,
  type AuthPrincipal,
  type SessionAuth,
} from './auth/authService';
import { CAREER_SUPER_PROMPT_REVISION } from './prompts/careerSuperPrompt';
import {
  searchHhVacancies,
  type HhVacancySample,
} from './connectors/hhVacancySearch';
import { searchRemotiveVacancies } from './connectors/remotiveVacancySearch';
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
import {
  vacancySubscriptionInputSchema,
  type VacancySample,
} from './domain/vacancy';
import {
  VacancyIntelligenceService,
} from './vacancies/vacancyIntelligenceService';
import { vacancySourceRegistryView } from './vacancies/vacancySourceRegistry';
import { MultiSourceVacancyEngine } from './vacancies/multiSourceVacancyEngine';

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
  searchRemotive?: (input: {
    text: string;
    perPage?: number;
  }) => Promise<VacancySample>;
  importProfile?: (url: string) => Promise<ProfileUrlImportResult>;
  oauthTransport?: OAuthTransport;
  careerCommandExecutor?: ConnectorExecutor;
  vacancyIntelligenceService?: VacancyIntelligenceService;
  multiSourceVacancyEngine?: MultiSourceVacancyEngine;
}

interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    retryable: boolean;
    /**
     * Per-field messages for form submissions. Without these a rejected
     * registration collapses into one anonymous line and the candidate cannot
     * tell which field to fix (B139).
     */
    fields?: Record<string, string>;
  };
}

export async function buildApp({
  config,
  coachProvider,
  candidateStore,
  authService,
  serveStatic = true,
  searchVacancies = searchHhVacancies,
  searchRemotive = searchRemotiveVacancies,
  importProfile = importPublicProfileUrl,
  oauthTransport,
  careerCommandExecutor,
  vacancyIntelligenceService,
  multiSourceVacancyEngine,
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
  const vacancyIntelligence =
    vacancyIntelligenceService ??
    new VacancyIntelligenceService({
      store: candidateStore,
      connectors: {
        hh: searchVacancies,
        remotive: searchRemotive,
      },
    });
  if (authService && 'setCandidateStore' in authService) {
    (authService as { setCandidateStore(s: CandidateStore): void }).setCandidateStore(candidateStore);
  }
  const multiSourceEngine =
    multiSourceVacancyEngine ??
    new MultiSourceVacancyEngine({
      fetcher: async (source, options) => {
        if (source.type === 'hh') {
          const sample = await searchVacancies({
            text: options?.query || 'Developer',
            perPage: 20,
          });
          return sample.items.map((v) => ({
            id: v.id,
            fingerprint: v.id,
            title: v.title,
            company: v.company,
            location: v.location,
            salary: v.salary
              ? {
                  from: v.salary.from ?? undefined,
                  to: v.salary.to ?? undefined,
                  currency: v.salary.currency,
                }
              : undefined,
            description: v.title,
            requiredSkills: v.requirements ?? [],
            url: v.sourceUrl,
            provenance: {
              sourceType: 'hh' as const,
              sourceId: source.id,
              sourceUrl: v.sourceUrl,
              observedAt: new Date().toISOString(),
            },
            publishedAt: v.publishedAt ?? new Date().toISOString(),
            status: 'active' as const,
          }));
        }
        if (source.type === 'remotive') {
          const sample = await searchRemotive({
            text: options?.query || 'Engineer',
            perPage: 20,
          });
          return sample.items.map((v) => ({
            id: v.id,
            fingerprint: v.id,
            title: v.title,
            company: v.company,
            location: v.location,
            isRemote: true,
            description: v.title,
            requiredSkills: v.requirements ?? [],
            url: v.sourceUrl,
            provenance: {
              sourceType: 'remotive' as const,
              sourceId: source.id,
              sourceUrl: v.sourceUrl,
              observedAt: new Date().toISOString(),
            },
            publishedAt: v.publishedAt ?? new Date().toISOString(),
            status: 'active' as const,
          }));
        }
        return [];
      },
    });
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

  function requireAdmin(
    request: Parameters<typeof authenticateSession>[0],
    reply: Parameters<typeof sendError>[0],
  ): AuthPrincipal | null {
    const principal = authenticateSession(request, authService, config);
    if (!principal) {
      void sendError(reply, request, 401, 'unauthorized', 'Нужен вход в аккаунт.', false);
      return null;
    }
    if (principal.role !== 'admin') {
      void sendError(reply, request, 403, 'forbidden', 'Раздел доступен только администратору.', false);
      return null;
    }
    return principal;
  }

  app.get('/api/v1/admin/users', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const query = adminUserQuerySchema.parse(request.query);
    return {
      data: authService.listUsers
        ? authService.listUsers({ query: query.query, limit: query.limit, offset: query.offset })
        : { total: 0, users: [] },
      meta: { requestId: request.id },
    };
  });

  app.get('/api/v1/admin/users/:userId', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const { userId } = request.params as { userId: string };
    const user = authService.getUser ? authService.getUser(userId) : null;
    if (!user) {
      return sendError(reply, request, 404, 'not_found', 'Пользователь не найден.', false);
    }
    return { data: user, meta: { requestId: request.id } };
  });

  const adminUserPatchSchema = z.object({
    role: z.enum(['candidate', 'admin']).optional(),
    email: z.string().email().nullable().optional(),
    displayName: z.string().max(255).nullable().optional(),
    headline: z.string().max(255).nullable().optional(),
    location: z.string().max(255).nullable().optional(),
    workMode: z.enum(['office', 'hybrid', 'remote', 'flexible']).nullable().optional(),
    subscriptionTier: z.enum(['free', 'pro', 'executive', 'enterprise']).optional(),
    subscriptionStatus: z.enum(['active', 'trialing', 'past_due', 'canceled']).optional(),
    subscriptionExpiresAt: z.string().nullable().optional(),
    subscriptionNotes: z.string().max(1000).nullable().optional(),
  });

  app.patch('/api/v1/admin/users/:userId', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const { userId } = request.params as { userId: string };
    const body = adminUserPatchSchema.parse(request.body ?? {});
    try {
      if (body.role && authService.setUserRole) {
        authService.setUserRole(userId, body.role, principal);
      }
      const updated = authService.updateUserByAdmin
        ? authService.updateUserByAdmin(userId, body, principal)
        : authService.getUser?.(userId);
      return { data: updated, meta: { requestId: request.id } };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Не удалось обновить пользователя.';
      return sendError(reply, request, 400, 'bad_request', message, false);
    }
  });

  const adminUserBlockSchema = z.object({
    blocked: z.boolean(),
  });

  app.post('/api/v1/admin/users/:userId/block', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const { userId } = request.params as { userId: string };
    const body = adminUserBlockSchema.parse(request.body ?? {});
    try {
      const updated = authService.setUserBlocked
        ? authService.setUserBlocked(userId, body.blocked, principal)
        : null;
      return { data: updated, meta: { requestId: request.id } };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Не удалось изменить статус блокировки.';
      return sendError(reply, request, 400, 'bad_request', message, false);
    }
  });

  const adminUserPasswordResetSchema = z.object({
    newPassword: z.string().min(8).max(256),
  });

  app.post('/api/v1/admin/users/:userId/reset-password', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const { userId } = request.params as { userId: string };
    const body = adminUserPasswordResetSchema.parse(request.body ?? {});
    try {
      if (authService.adminSetUserPassword) {
        await authService.adminSetUserPassword(userId, body.newPassword, principal);
      }
      return { data: { success: true }, meta: { requestId: request.id } };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Не удалось сбросить пароль.';
      return sendError(reply, request, 400, 'bad_request', message, false);
    }
  });

  app.post('/api/v1/admin/users/:userId/impersonate', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const { userId } = request.params as { userId: string };
    try {
      if (!authService.impersonateUser) {
        throw new Error('Имперсонация не поддерживается службой авторизации.');
      }
      const impersonated = await authService.impersonateUser(userId, principal);
      setSessionCookie(reply, impersonated.sessionToken, config.secureCookies);
      return {
        data: {
          redirectUrl: '/app',
          user: impersonated.principal,
        },
        meta: { requestId: request.id },
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Не удалось войти от имени пользователя.';
      return sendError(reply, request, 400, 'bad_request', message, false);
    }
  });

  app.delete('/api/v1/admin/users/:userId', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const { userId } = request.params as { userId: string };
    try {
      if (authService.deleteUserByAdmin) {
        authService.deleteUserByAdmin(userId, principal);
      }
      return { data: { success: true }, meta: { requestId: request.id } };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Не удалось удалить пользователя.';
      return sendError(reply, request, 400, 'bad_request', message, false);
    }
  });

  app.get('/api/v1/admin/audit', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const query = request.query as { limit?: string; offset?: string };
    const limit = Math.min(Number(query.limit) || 50, 100);
    const offset = Math.max(Number(query.offset) || 0, 0);
    const result = authService.listAudit
      ? authService.listAudit({ limit, offset })
      : { total: 0, records: [] };
    return { data: result, meta: { requestId: request.id } };
  });

  const adminVacancyQuerySchema = z.object({
    sourceId: z.string().optional(),
    type: z.string().optional(),
    query: z.string().optional(),
    isRemote: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  });

  app.get('/api/v1/admin/vacancies', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const query = adminVacancyQuerySchema.parse(request.query ?? {});
    const result = multiSourceEngine.getVacancies(query);
    return {
      data: result,
      meta: { requestId: request.id },
    };
  });

  app.get('/api/v1/admin/vacancy-sources', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    return {
      data: multiSourceEngine.getSources(),
      meta: { requestId: request.id },
    };
  });

  const adminVacancySourceTestSchema = z.object({
    query: z.string().max(100).optional(),
  });

  app.post('/api/v1/admin/vacancy-sources/:sourceId/test', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const { sourceId } = request.params as { sourceId: string };
    const body = adminVacancySourceTestSchema.parse(request.body ?? {});
    const result = await multiSourceEngine.testSource(sourceId, body.query);
    return {
      data: result,
      meta: { requestId: request.id },
    };
  });

  app.post('/api/v1/admin/vacancy-sources/sync-all', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    await multiSourceEngine.syncAll();
    return {
      data: { success: true, count: multiSourceEngine.getVacancies().total },
      meta: { requestId: request.id },
    };
  });

  app.post('/api/v1/admin/vacancy-sources/:sourceId/sync', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const { sourceId } = request.params as { sourceId: string };
    await multiSourceEngine.syncSource(sourceId);
    return {
      data: { success: true },
      meta: { requestId: request.id },
    };
  });

  const adminVacancySourceToggleSchema = z.object({
    enabled: z.boolean(),
  });

  app.post('/api/v1/admin/vacancy-sources/:sourceId/toggle', async (request, reply) => {
    const principal = requireAdmin(request, reply);
    if (!principal) return;
    const { sourceId } = request.params as { sourceId: string };
    const body = adminVacancySourceToggleSchema.parse(request.body ?? {});
    const updated = multiSourceEngine.toggleSource(sourceId, body.enabled);
    return {
      data: updated,
      meta: { requestId: request.id },
    };
  });

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
      const parsed = registrationSchema.safeParse(request.body);
      if (!parsed.success) {
        const fields = fieldMessages(parsed.error);
        return sendError(
          reply,
          request,
          422,
          'validation_failed',
          Object.values(fields)[0] ?? 'Проверьте заполненные поля.',
          false,
          fields,
        );
      }
      const body = parsed.data;
      try {
        const authenticated = await authService.register(
          deriveUsernameFromEmail(body.email, (candidate) =>
            authService.isUsernameTaken(candidate),
          ),
          body.password,
          candidateStore,
          {
            email: body.email,
            displayName: body.displayName,
          },
        );
        setSessionCookie(reply, authenticated.sessionToken, config.secureCookies);
        return reply.code(201).send({
          data: publicPrincipal(authenticated.principal),
          meta: { requestId: request.id },
        });
      } catch (error) {
        if (error instanceof AuthUsernameTakenError || error instanceof AuthEmailTakenError) {
          // Both collisions now trace back to the address: the handle is
          // derived from it, so the address is the field the candidate can act
          // on. Wording stays identical either way, so a probe cannot tell a
          // taken handle from a taken address.
          const message = 'Этот email уже связан с другим аккаунтом.';
          return sendError(reply, request, 409, 'email_taken', message, false, {
            email: message,
          });
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

  app.get('/api/v1/account', async (request, reply) => {
    const sessionToken =
      request.cookies[sessionCookieName(config.secureCookies)] ?? '';
    const account = authService.getAccount?.(sessionToken) ?? null;
    if (!account) {
      return sendError(
        reply,
        request,
        401,
        'unauthorized',
        'Нужна действующая сессия.',
        false,
      );
    }
    return {
      data: account,
      meta: { requestId: request.id },
    };
  });

  app.patch('/api/v1/account/profile', async (request, reply) => {
    if (!hasAllowedOrigin(request, config)) return csrfError(request, reply);
    const sessionToken =
      request.cookies[sessionCookieName(config.secureCookies)] ?? '';
    const body = accountProfileSchema.parse(request.body);
    try {
      const account = authService.updateAccount?.(sessionToken, body) ?? null;
      if (!account) {
        return sendError(
          reply,
          request,
          401,
          'unauthorized',
          'Нужна действующая сессия.',
          false,
        );
      }
      return {
        data: account,
        meta: { requestId: request.id },
      };
    } catch (error) {
      if (error instanceof AuthEmailTakenError) {
        return sendError(
          reply,
          request,
          409,
          'email_taken',
          'Этот email уже связан с другим аккаунтом.',
          false,
        );
      }
      throw error;
    }
  });

  app.post('/api/v1/account/password', async (request, reply) => {
    if (!hasAllowedOrigin(request, config)) return csrfError(request, reply);
    const sessionToken =
      request.cookies[sessionCookieName(config.secureCookies)] ?? '';
    const body = passwordChangeSchema.parse(request.body);
    try {
      const authenticated =
        (await authService.changePassword?.(
          sessionToken,
          body.currentPassword,
          body.newPassword,
        )) ?? null;
      if (!authenticated) {
        return sendError(
          reply,
          request,
          401,
          'unauthorized',
          'Нужна действующая сессия.',
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
    } catch (error) {
      if (error instanceof AuthInvalidPasswordError) {
        return sendError(
          reply,
          request,
          400,
          'current_password_invalid',
          'Текущий пароль указан неверно.',
          false,
        );
      }
      throw error;
    }
  });

  app.post(
    '/api/v1/auth/password-reset-requests',
    {
      config: { rateLimit: { max: 5, timeWindow: '1 hour' } },
    },
    async (request, reply) => {
      if (!hasAllowedOrigin(request, config)) return csrfError(request, reply);
      const body = passwordResetRequestSchema.parse(request.body);
      try {
        await authService.requestPasswordReset?.(body.identifier);
      } catch (error) {
        request.log.warn(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'password-reset-delivery-failed',
        );
      }
      return reply.code(202).send({
        data: {
          accepted: true,
          deliveryConfigured: Boolean(config.accountEmail),
        },
        meta: { requestId: request.id },
      });
    },
  );

  app.delete('/api/v1/account/sessions', async (request, reply) => {
    if (!hasAllowedOrigin(request, config)) return csrfError(request, reply);
    const sessionToken =
      request.cookies[sessionCookieName(config.secureCookies)] ?? '';
    const revoked = authService.revokeOtherSessions?.(sessionToken) ?? null;
    if (revoked === null) {
      return sendError(
        reply,
        request,
        401,
        'unauthorized',
        'Нужна действующая сессия.',
        false,
      );
    }
    return {
      data: { revoked },
      meta: { requestId: request.id },
    };
  });

  app.post(
    '/api/v1/auth/password-resets',
    {
      config: { rateLimit: { max: 8, timeWindow: '15 minutes' } },
    },
    async (request, reply) => {
      if (!hasAllowedOrigin(request, config)) return csrfError(request, reply);
      const body = passwordResetSchema.parse(request.body);
      try {
        const authenticated = await authService.resetPassword?.(
          body.token,
          body.newPassword,
        );
        if (!authenticated) throw new AuthInvalidResetTokenError();
        setSessionCookie(
          reply,
          authenticated.sessionToken,
          config.secureCookies,
        );
        return {
          data: publicPrincipal(authenticated.principal),
          meta: { requestId: request.id },
        };
      } catch (error) {
        if (error instanceof AuthInvalidResetTokenError) {
          return sendError(
            reply,
            request,
            400,
            'password_reset_invalid',
            'Ссылка недействительна или уже истекла.',
            false,
          );
        }
        throw error;
      }
    },
  );

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

  app.post(
    '/api/v1/candidate/documents',
    {
      bodyLimit: 8 * 1_024 * 1_024,
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
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
      const body = candidateDocumentSchema.parse(request.body);
      try {
        const stored = candidateStore.saveDocument(candidate.id, body);
        return reply.code(stored.created ? 201 : 200).send({
          data: stored,
          meta: { requestId: request.id },
        });
      } catch (error) {
        if (error instanceof CandidateDocumentValidationError) {
          return sendError(
            reply,
            request,
            400,
            'document_invalid',
            'Файл не прошёл проверку формата или размера.',
            false,
          );
        }
        if (error instanceof CandidateDocumentVersionError) {
          return sendError(
            reply,
            request,
            409,
            'document_version_conflict',
            'Предыдущая версия документа недоступна.',
            false,
          );
        }
        throw error;
      }
    },
  );

  app.get<{ Params: { documentId: string } }>(
    '/api/v1/candidate/documents/:documentId',
    async (request, reply) => {
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
      if (!candidate) return;
      const documentId = z.string().uuid().parse(request.params.documentId);
      const document = candidateStore.getDocument(candidate.id, documentId);
      if (!document) {
        return sendError(
          reply,
          request,
          404,
          'document_not_found',
          'Документ не найден.',
          false,
        );
      }
      return {
        data: document,
        meta: { requestId: request.id },
      };
    },
  );

  app.get<{ Params: { documentId: string } }>(
    '/api/v1/candidate/documents/:documentId/download',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
      if (!candidate) return;
      const documentId = z.string().uuid().parse(request.params.documentId);
      const document = candidateStore.getDocument(candidate.id, documentId);
      if (!document) {
        return sendError(
          reply,
          request,
          404,
          'document_not_found',
          'Документ не найден.',
          false,
        );
      }
      reply.header('Cache-Control', 'private, no-store');
      reply.header('X-Content-Type-Options', 'nosniff');
      reply.header(
        'Content-Disposition',
        `attachment; filename="openqareer-document"; filename*=UTF-8''${encodeHeaderFileName(document.fileName)}`,
      );
      return reply
        .type(document.mimeType)
        .send(Buffer.from(document.contentBase64, 'base64'));
    },
  );

  app.patch<{ Params: { documentId: string } }>(
    '/api/v1/candidate/documents/:documentId/retention',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
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
      const documentId = z.string().uuid().parse(request.params.documentId);
      const body = documentRetentionSchema.parse(request.body);
      try {
        const document = candidateStore.setDocumentRetention(
          candidate.id,
          documentId,
          body.retentionUntil,
          new Date().toISOString(),
        );
        if (!document) {
          return sendError(
            reply,
            request,
            404,
            'document_not_found',
            'Документ не найден.',
            false,
          );
        }
        return { data: document, meta: { requestId: request.id } };
      } catch (error) {
        if (error instanceof CandidateDocumentRetentionError) {
          return sendError(
            reply,
            request,
            422,
            'document_retention_invalid',
            'Срок хранения должен быть в будущем и не дальше десяти лет.',
            false,
          );
        }
        throw error;
      }
    },
  );

  app.delete<{ Params: { documentId: string } }>(
    '/api/v1/candidate/documents/:documentId',
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
      const documentId = z.string().uuid().parse(request.params.documentId);
      if (!candidateStore.deleteDocument(candidate.id, documentId)) {
        return sendError(
          reply,
          request,
          404,
          'document_not_found',
          'Документ не найден.',
          false,
        );
      }
      return reply.code(204).send();
    },
  );

  app.get('/api/v1/candidate/matched-vacancies', async (request, reply) => {
    const candidate = authenticateCandidate(
      request,
      reply,
      candidateStore,
      authService,
      config,
    );
    if (!candidate) return;

    const snapshot = candidateStore.getSnapshot(candidate.id);
    const memory = snapshot?.memory ?? [];
    const confirmedSkills = memory
      .filter((m) => m.kind === 'fact' && m.confidence === 'candidate-confirmed')
      .map((m) => m.statement);

    const matched = multiSourceEngine.getMatchedVacancies({
      candidateId: candidate.id,
      targetRoles: ['Руководитель разработки', 'Senior Developer'],
      confirmedSkills: confirmedSkills.length > 0 ? confirmedSkills : ['TypeScript', 'React', 'Node.js', 'PostgreSQL'],
      confirmedFacts: confirmedSkills,
      preferredRemote: true,
    });

    return {
      data: matched,
      meta: { requestId: request.id },
    };
  });

  app.get('/api/v1/candidate/vacancy-sources', async (request, reply) => {
    const candidate = authenticateCandidate(
      request,
      reply,
      candidateStore,
      authService,
      config,
    );
    if (!candidate) return;
    return {
      data: vacancySourceRegistryView(candidateStore.listVacancySourceHealth()),
      meta: { requestId: request.id },
    };
  });

  app.get('/api/v1/candidate/vacancy-subscriptions', async (request, reply) => {
    const candidate = authenticateCandidate(
      request,
      reply,
      candidateStore,
      authService,
      config,
    );
    if (!candidate) return;
    return {
      data: candidateStore.listVacancySubscriptions(candidate.id),
      meta: { requestId: request.id },
    };
  });

  app.post(
    '/api/v1/candidate/vacancy-subscriptions',
    { config: { rateLimit: { max: 12, timeWindow: '1 hour' } } },
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
      const body = vacancySubscriptionInputSchema.parse(request.body);
      const data = await vacancyIntelligence.createAndRefresh(
        candidate.id,
        body,
      );
      return reply.code(201).send({
        data,
        meta: { requestId: request.id },
      });
    },
  );

  app.get<{ Params: { subscriptionId: string } }>(
    '/api/v1/candidate/vacancy-subscriptions/:subscriptionId/vacancies',
    async (request, reply) => {
      const candidate = authenticateCandidate(
        request,
        reply,
        candidateStore,
        authService,
        config,
      );
      if (!candidate) return;
      const subscriptionId = z
        .string()
        .uuid()
        .parse(request.params.subscriptionId);
      const subscription = candidateStore.getVacancySubscription(
        candidate.id,
        subscriptionId,
      );
      if (!subscription) {
        return sendError(
          reply,
          request,
          404,
          'vacancy_subscription_not_found',
          'Поисковое направление не найдено.',
          false,
        );
      }
      return {
        data: {
          subscription,
          vacancies: candidateStore.listSubscriptionVacancies(
            candidate.id,
            subscriptionId,
          ),
        },
        meta: { requestId: request.id },
      };
    },
  );

  app.patch<{ Params: { subscriptionId: string } }>(
    '/api/v1/candidate/vacancy-subscriptions/:subscriptionId',
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
      const subscriptionId = z
        .string()
        .uuid()
        .parse(request.params.subscriptionId);
      const body = z
        .object({ status: z.enum(['active', 'paused']) })
        .parse(request.body);
      const subscription = candidateStore.setVacancySubscriptionStatus(
        candidate.id,
        subscriptionId,
        body.status,
        new Date().toISOString(),
      );
      if (!subscription) {
        return sendError(
          reply,
          request,
          404,
          'vacancy_subscription_not_found',
          'Поисковое направление не найдено.',
          false,
        );
      }
      return {
        data: subscription,
        meta: { requestId: request.id },
      };
    },
  );

  app.post<{ Params: { subscriptionId: string } }>(
    '/api/v1/candidate/vacancy-subscriptions/:subscriptionId/refresh',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
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
      const subscriptionId = z
        .string()
        .uuid()
        .parse(request.params.subscriptionId);
      if (
        !candidateStore.getVacancySubscription(candidate.id, subscriptionId)
      ) {
        return sendError(
          reply,
          request,
          404,
          'vacancy_subscription_not_found',
          'Поисковое направление не найдено.',
          false,
        );
      }
      return {
        data: await vacancyIntelligence.refreshCandidateSubscription(
          candidate.id,
          subscriptionId,
        ),
        meta: { requestId: request.id },
      };
    },
  );

  app.delete<{ Params: { subscriptionId: string } }>(
    '/api/v1/candidate/vacancy-subscriptions/:subscriptionId',
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
      const subscriptionId = z
        .string()
        .uuid()
        .parse(request.params.subscriptionId);
      if (
        !candidateStore.deleteVacancySubscription(
          candidate.id,
          subscriptionId,
        )
      ) {
        return sendError(
          reply,
          request,
          404,
          'vacancy_subscription_not_found',
          'Поисковое направление не найдено.',
          false,
        );
      }
      return reply.code(204).send();
    },
  );

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

  app.get('/api/v1/candidate/resume', async (request, reply) => {
    const candidate = authenticateCandidate(
      request,
      reply,
      candidateStore,
      authService,
      config,
    );
    if (!candidate) return;
    return {
      data: resumeStudioView(candidateStore, candidate.id),
      meta: { requestId: request.id },
    };
  });

  app.put(
    '/api/v1/candidate/resume',
    {
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
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
      const draft = resumeDraftSchema.parse(request.body);
      const projection = buildResumeStudioProjection({
        ...draft,
        evidence: candidateStore.getSnapshot(candidate.id).memory,
      });
      candidateStore.saveResumeDraft(
        candidate.id,
        draft,
        projection.evidenceSnapshot,
      );
      return {
        data: resumeStudioView(candidateStore, candidate.id),
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

  app.get('/api/v1/candidate/career-commands', async (request, reply) => {
    const candidate = authenticateCandidate(
      request,
      reply,
      candidateStore,
      authService,
      config,
    );
    if (!candidate) return;
    return {
      data: candidateStore.listCareerCommands(candidate.id),
      meta: { requestId: request.id },
    };
  });

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
          executionTarget: body.executionTarget ?? null,
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
    if (getErrorStatusCode(error) === 429) {
      return sendError(
        reply,
        request,
        429,
        'rate_limit_exceeded',
        'Слишком много запросов. Повторите действие через минуту.',
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
        // Each surface has its own prerendered first paint. Serving the
        // workspace document on `/admin` left administrators looking at the
        // candidate cabinet for seconds while the bundle arrived (B089).
        return reply
          .header('Cache-Control', 'no-store, max-age=0')
          .sendFile(entryDocumentFor(request.url, config.staticRoot));
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

const candidateDocumentSchema = z.object({
  kind: z.enum([
    'resume',
    'cover_letter',
    'certificate',
    'portfolio',
    'profile_export',
    'other',
  ]),
  source: z.enum(['upload', 'generated', 'import']),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .refine((value) => !hasUnsafeFileNameCharacter(value)),
  mimeType: z.enum([
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'application/json',
  ]),
  contentBase64: z
    .string()
    .min(4)
    .max(7_100_000)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/u),
  extractedText: z.string().trim().max(200_000).optional(),
  parseStatus: z.enum(['pending', 'ready', 'failed', 'not_applicable']),
  replacesDocumentId: z.string().uuid().optional(),
});

const documentRetentionSchema = z.object({
  retentionUntil: z.string().datetime({ offset: true }).nullable(),
});

const ADMIN_DOCUMENT = 'admin.html';

const adminUserQuerySchema = z.object({
  query: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

const hhMarketQuerySchema = z.object({
  text: z.string().trim().min(2).max(200),
  perPage: z.coerce.number().int().min(1).max(20).default(12),
});

function hasUnsafeFileNameCharacter(value: string): boolean {
  return [...value].some(
    (character) =>
      character === '/' || character === '\\' || character.charCodeAt(0) < 32,
  );
}

const loginSchema = z.object({
  username: z.string().trim().min(3).max(80),
  password: z.string().min(1).max(256),
});

/**
 * B139: no login field. The candidate gives a name, an address and a password;
 * the account handle is derived. Every rule carries the message the form shows
 * next to the offending field, so a rejection can never collapse into one
 * anonymous "проверьте формат и длину переданных данных".
 *
 * The message comes from the shared rule itself rather than being fixed per
 * field: a 300-character password must not be answered with "сделайте длиннее".
 */
function fieldGovernedBy(check: (value: string) => string | null, trim: boolean) {
  const base = trim ? z.string().trim() : z.string();
  return base.superRefine((value, ctx) => {
    const message = check(value);
    if (message !== null) ctx.addIssue({ code: 'custom', message });
  });
}

const passwordField = fieldGovernedBy(getPasswordError, false);

const registrationSchema = z.object({
  displayName: fieldGovernedBy(getNameError, true),
  email: fieldGovernedBy(getEmailError, true),
  password: passwordField,
});

const accountProfileSchema = z
  .object({
    email: z.string().trim().email().max(254).nullable().optional(),
    displayName: z.string().trim().min(2).max(120).nullable().optional(),
    headline: z.string().trim().min(2).max(220).nullable().optional(),
    location: z.string().trim().min(2).max(160).nullable().optional(),
    workMode: z
      .enum(['office', 'hybrid', 'remote', 'flexible'])
      .nullable()
      .optional(),
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'at least one profile field is required',
  });

const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1).max(256),
    newPassword: passwordField,
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ['newPassword'],
    message: 'new password must be different',
  });

const passwordResetRequestSchema = z.object({
  identifier: z.string().trim().min(3).max(254),
});

const passwordResetSchema = z.object({
  token: z.string().regex(/^oqr_[A-Za-z0-9_-]{40,}$/),
  newPassword: passwordField,
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
  executionTarget: hhApplicationExecutionTargetSchema.optional(),
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

interface ResumeStudioView {
  draft: ResumeDraft | null;
  savedAt: { createdAt: string; updatedAt: string } | null;
  projection: ResumeStudioProjection;
  evidenceFreshness: ResumeEvidenceFreshness;
}

/**
 * Rebuilds both resume variants from the dossier as it stands now and compares
 * it with the evidence the candidate approved when the draft was saved, so a
 * revoked fact surfaces instead of surviving inside a generated document.
 */
function resumeStudioView(
  candidateStore: CandidateStore,
  candidateId: string,
): ResumeStudioView {
  const snapshot = candidateStore.getSnapshot(candidateId);
  const stored = snapshot.resume;
  const projection = buildResumeStudioProjection({
    ...(stored?.draft ?? EMPTY_RESUME_DRAFT),
    evidence: snapshot.memory,
  });
  return {
    draft: stored?.draft ?? null,
    savedAt: stored
      ? { createdAt: stored.createdAt, updatedAt: stored.updatedAt }
      : null,
    projection,
    evidenceFreshness: validateResumeEvidenceFreshness(
      stored?.evidenceSnapshot ?? projection.evidenceSnapshot,
      snapshot.memory,
    ),
  };
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
  return 'index.html';
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
    email: principal.email,
    displayName: principal.displayName,
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

function encodeHeaderFileName(fileName: string): string {
  return encodeURIComponent(fileName).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sendError(
  reply: FastifyReply,
  request: FastifyRequest,
  statusCode: number,
  code: string,
  message: string,
  retryable: boolean,
  fields?: Record<string, string>,
): FastifyReply {
  const body: ErrorBody = {
    error: {
      code,
      message,
      requestId: request.id,
      retryable,
      ...(fields && Object.keys(fields).length > 0 ? { fields } : {}),
    },
  };
  return reply.code(statusCode).send(body);
}

/** Turns a Zod failure into the `{ field: message }` map the forms render. */
function fieldMessages(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === 'string' && !(field in fields)) {
      fields[field] = issue.message;
    }
  }
  return fields;
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
