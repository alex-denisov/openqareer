import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthPrincipal } from '../auth/authService';
import type { RouteDeps } from './deps';
import {
  authenticateSession,
  hasPreviewAccess,
  sendError,
  setSessionCookie,
  withDeps,
} from './helpers';
import { buildAdminVacancyPage } from '../vacancies/adminVacancyPage';
import { queueFallbackDescriptors } from '../providers/providerQueue';
import { describeRoleNamerQueue } from '../providers/roleNamer';
import { CAREER_SUPER_PROMPT_REVISION } from '../prompts/careerSuperPrompt';
import {
  adminVacancyQuerySchema,
  adminVacancySourceTestSchema,
  adminVacancySourceToggleSchema,
  adminUserBlockSchema,
  adminUserPatchSchema,
  adminUserPasswordResetSchema,
  adminUserQuerySchema,
} from './schemas';

function requireAdmin(
  deps: Pick<RouteDeps, 'authService' | 'config'>,
  request: Parameters<typeof authenticateSession>[0],
  reply: Parameters<typeof sendError>[0],
): AuthPrincipal | null {
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal) {
    void sendError(reply, request, 401, 'unauthorized', 'Нужен вход в аккаунт.', false);
    return null;
  }
  if (principal.role !== 'admin') {
    void sendError(
      reply,
      request,
      403,
      'forbidden',
      'Раздел доступен только администратору.',
      false,
    );
    return null;
  }
  return principal;
}

async function handleListUsers(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const query = adminUserQuerySchema.parse(request.query);
  return {
    data: deps.authService.listUsers
      ? deps.authService.listUsers({ query: query.query, limit: query.limit, offset: query.offset })
      : { total: 0, users: [] },
    meta: { requestId: request.id },
  };
}

async function handleGetUser(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const { userId } = request.params as { userId: string };
  const user = deps.authService.getUser ? deps.authService.getUser(userId) : null;
  if (!user) {
    return sendError(reply, request, 404, 'not_found', 'Пользователь не найден.', false);
  }
  return { data: user, meta: { requestId: request.id } };
}

async function handleListAudit(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const query = request.query as { limit?: string; offset?: string };
  const limit = Math.min(Number(query.limit) || 50, 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const result = deps.authService.listAudit
    ? deps.authService.listAudit({ limit, offset })
    : { total: 0, records: [] };
  return { data: result, meta: { requestId: request.id } };
}

async function handlePatchUser(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const { userId } = request.params as { userId: string };
  const body = adminUserPatchSchema.parse(request.body ?? {});
  try {
    if (body.role && deps.authService.setUserRole) {
      deps.authService.setUserRole(userId, body.role, principal);
    }
    const updated = deps.authService.updateUserByAdmin
      ? deps.authService.updateUserByAdmin(userId, body, principal)
      : deps.authService.getUser?.(userId);
    return { data: updated, meta: { requestId: request.id } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Не удалось обновить пользователя.';
    return sendError(reply, request, 400, 'bad_request', message, false);
  }
}

async function handleBlockUser(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const { userId } = request.params as { userId: string };
  const body = adminUserBlockSchema.parse(request.body ?? {});
  try {
    const updated = deps.authService.setUserBlocked
      ? deps.authService.setUserBlocked(userId, body.blocked, principal)
      : null;
    return { data: updated, meta: { requestId: request.id } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Не удалось изменить статус блокировки.';
    return sendError(reply, request, 400, 'bad_request', message, false);
  }
}

async function handleResetUserPassword(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const { userId } = request.params as { userId: string };
  const body = adminUserPasswordResetSchema.parse(request.body ?? {});
  try {
    if (deps.authService.adminSetUserPassword) {
      await deps.authService.adminSetUserPassword(userId, body.newPassword, principal);
    }
    return { data: { success: true }, meta: { requestId: request.id } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Не удалось сбросить пароль.';
    return sendError(reply, request, 400, 'bad_request', message, false);
  }
}

async function handleDeleteUser(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const { userId } = request.params as { userId: string };
  try {
    if (deps.authService.deleteUserByAdmin) {
      deps.authService.deleteUserByAdmin(userId, principal);
    }
    return { data: { success: true }, meta: { requestId: request.id } };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Не удалось удалить пользователя.';
    return sendError(reply, request, 400, 'bad_request', message, false);
  }
}

async function handleImpersonate(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const { userId } = request.params as { userId: string };
  try {
    if (!deps.authService.impersonateUser) {
      throw new Error('Имперсонация не поддерживается службой авторизации.');
    }
    const impersonated = await deps.authService.impersonateUser(userId, principal);
    setSessionCookie(reply, impersonated.sessionToken, deps.config.secureCookies);
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
}

async function handleGetVacancies(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const query = adminVacancyQuerySchema.parse(request.query ?? {});
  // Целиком выборка до консоли не доезжает: маршрут рвёт ответ примерно на
  // 20 220 байтах при любом `limit` (INC-032). Фильтры считаются по всему пулу,
  // а наружу уходит страница краткого вида внутри доказанного бюджета.
  const { total, items, statsBySource } = deps.multiSourceEngine.getVacancies({
    ...query,
    offset: 0,
    limit: Number.MAX_SAFE_INTEGER,
  });
  const page = buildAdminVacancyPage(items, query.offset, query.limit);
  return {
    data: {
      total,
      items: page.items,
      statsBySource,
      offset: page.offset,
      nextOffset: page.nextOffset,
    },
    meta: { requestId: request.id },
  };
}

async function handleGetVacancy(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const { vacancyId } = request.params as { vacancyId: string };
  const vacancy = deps.multiSourceEngine.getVacancy(vacancyId);
  if (!vacancy) {
    return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  }
  return { data: vacancy, meta: { requestId: request.id } };
}

async function testSource(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const { sourceId } = request.params as { sourceId: string };
  const body = adminVacancySourceTestSchema.parse(request.body ?? {});
  return {
    data: await deps.multiSourceEngine.testSource(sourceId, body.query),
    meta: { requestId: request.id },
  };
}

async function syncAllSources(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  // Per source, not one blanket flag: a run where every source failed used to
  // answer `success: true` with the size of the previous pool (B161 review §3).
  const outcomes = await deps.multiSourceEngine.syncAll();
  return {
    data: {
      success: outcomes.every((outcome) => outcome.status !== 'error'),
      count: deps.multiSourceEngine.getVacancies().total,
      outcomes,
    },
    meta: { requestId: request.id },
  };
}

async function syncSource(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const { sourceId } = request.params as { sourceId: string };
  const outcome = await deps.multiSourceEngine.syncSource(sourceId);
  if (outcome.status === 'unknown_source') {
    return sendError(
      reply,
      request,
      404,
      'vacancy_source_not_found',
      `Источник вакансий ${sourceId} не найден.`,
      false,
    );
  }
  return {
    data: { success: outcome.status === 'healthy', outcome },
    meta: { requestId: request.id },
  };
}

async function toggleSource(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireAdmin(deps, request, reply);
  if (!principal) return;
  const { sourceId } = request.params as { sourceId: string };
  const body = adminVacancySourceToggleSchema.parse(request.body ?? {});
  return {
    data: deps.multiSourceEngine.toggleSource(sourceId, body.enabled),
    meta: { requestId: request.id },
  };
}

function providerStatusData(deps: RouteDeps) {
  const { config } = deps;
  return {
    personalDataRoute: {
      provider: config.personalProvider ?? 'openai',
      model: config.model,
      // У персонального класса данных теперь такая же очередь (решение
      // владельца 2026-09-02), и отчёт обязан её показывать.
      fallbackModels: queueFallbackDescriptors({
        head: { provider: config.personalProvider ?? 'openai', model: config.model },
        fallbacks: config.personalFallbacks,
        credentials: config.providerCredentials ?? {},
      }),
    },
    syntheticDataRoute: {
      provider: config.syntheticProvider ?? 'openrouter',
      model: config.syntheticModel ?? 'nvidia/nemotron-3-ultra-550b-a55b:free',
      // Порядок берётся у самой маршрутизации, а не у каталога: иначе отчёт
      // расходится с тем, что сервер делает на самом деле (B183).
      fallbackModels: queueFallbackDescriptors({
        head: {
          provider: config.syntheticProvider ?? 'openrouter',
          model: config.syntheticModel,
        },
        fallbacks: config.syntheticFallbacks,
        credentials: config.providerCredentials ?? {},
      }),
      outputValidation: 'server-side-strict-schema',
    },
    qualityFloor: 'gpt-5.6-sol',
    promptRevision: CAREER_SUPER_PROMPT_REVISION,
    providers: config.providerCatalogStatus ?? [],
    // Очередь называния ролей и её последние отказы: без них молчание головы
    // очереди на проде недоказуемо — лог сервера снаружи не читается
    // (INC-035, B186).
    roleNaming: {
      queue: describeRoleNamerQueue(deps.roleNamer),
      recentFailures: deps.roleNamingFailures.recent(),
    },
    ready: true,
  };
}

async function handleProviderStatus(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (
    !hasPreviewAccess(request, deps.config.previewToken) &&
    authenticateSession(request, deps.authService, deps.config)?.role !== 'admin'
  ) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна сессия администратора.', false);
  }
  return { data: providerStatusData(deps), meta: { requestId: request.id } };
}

export async function registerAdminRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get('/api/v1/admin/users', withDeps(deps, handleListUsers));
  app.get('/api/v1/admin/users/:userId', withDeps(deps, handleGetUser));
  app.patch('/api/v1/admin/users/:userId', withDeps(deps, handlePatchUser));
  app.post('/api/v1/admin/users/:userId/block', withDeps(deps, handleBlockUser));
  app.post('/api/v1/admin/users/:userId/reset-password', withDeps(deps, handleResetUserPassword));
  app.post('/api/v1/admin/users/:userId/impersonate', withDeps(deps, handleImpersonate));
  app.delete('/api/v1/admin/users/:userId', withDeps(deps, handleDeleteUser));
  app.get('/api/v1/admin/audit', withDeps(deps, handleListAudit));

  app.get('/api/v1/admin/vacancies', withDeps(deps, handleGetVacancies));
  app.get('/api/v1/admin/vacancies/:vacancyId', withDeps(deps, handleGetVacancy));
  app.get('/api/v1/admin/vacancy-sources', async (request, reply) => {
    const principal = requireAdmin(deps, request, reply);
    if (!principal) return;
    // Живость и доверие едут вместе с самой площадкой: администратор читает
    // «жива ли она» и «можно ли ей верить» как две разные вещи (B200).
    const health = new Map(
      deps.multiSourceEngine.getSourceHealthReport().map((item) => [item.sourceId, item]),
    );
    const sources = deps.multiSourceEngine.getSources().map((source) => {
      const measured = health.get(source.id);
      return measured
        ? { ...source, health: { liveness: measured.liveness, trust: measured.trust } }
        : source;
    });
    return { data: sources, meta: { requestId: request.id } };
  });
  app.post('/api/v1/admin/vacancy-sources/:sourceId/test', withDeps(deps, testSource));
  app.post('/api/v1/admin/vacancy-sources/sync-all', withDeps(deps, syncAllSources));
  app.post('/api/v1/admin/vacancy-sources/:sourceId/sync', withDeps(deps, syncSource));
  app.post('/api/v1/admin/vacancy-sources/:sourceId/toggle', withDeps(deps, toggleSource));

  app.get('/api/v1/provider/status', withDeps(deps, handleProviderStatus));
}
