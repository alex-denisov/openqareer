import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { candidateWorkspaceSchema } from '../domain/candidateWorkspace';
import { resolveRoleNameLanguage } from '../domain/roleNameLanguage';
import { vacancySubscriptionInputSchema } from '../domain/vacancy';
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import type { NamedRole } from '../../shared/roleProposals';
import { buildMatchedVacancyPage } from '../vacancies/matchedVacancyPage';
import { buildRoleProposals } from '../vacancies/roleHypotheses';
import { vacancySourceRegistryView } from '../vacancies/vacancySourceRegistry';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { hhMarketQuerySchema } from './schemas';

type Handler = (
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

const SUBSCRIPTION_NOT_FOUND = {
  status: 404,
  code: 'vacancy_subscription_not_found',
  message: 'Поисковое направление не найдено.',
} as const;

const handleHhMarket: Handler = async ({ searchVacancies }, request, reply) => {
  const query = hhMarketQuerySchema.parse(request.query);
  try {
    return {
      data: await searchVacancies({ text: query.text, perPage: query.perPage }),
      meta: { requestId: request.id },
    };
  } catch (reason) {
    // A platform that closed its public search is not a platform having a bad
    // minute — «попробуйте позже» would promise a retry that cannot help
    // (B175, INC-022).
    const message = reason instanceof Error ? reason.message : String(reason);
    if (message.includes('official_access_required')) {
      return sendError(
        reply,
        request,
        502,
        'market_source_official_access_required',
        'hh.ru закрыл поиск вакансий без авторизации. Пока официальный доступ не получен, выборку с hh.ru продукт не показывает.',
        // Retrying a closed door changes nothing; only official access does.
        false,
      );
    }
    return sendError(
      reply,
      request,
      502,
      'market_source_unavailable',
      'hh.ru не вернул выборку. Попробуйте позже или добавьте вакансию вручную.',
      true,
    );
  }
};

/** Подтверждённый профиль кандидата — то, по чему вообще можно сопоставлять. */
function readMatchProfile(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): { confirmedSkills: string[]; targetRoles: string[] } {
  const snapshot = candidateStore.getSnapshot(candidateId);
  const memory = snapshot?.memory ?? [];
  const confirmedSkills = memory
    .filter(
      (m) => m.kind === 'fact' && (m.domain === 'skill' || m.confidence === 'candidate-confirmed'),
    )
    .map((m) => m.statement);

  const roleHypotheses = memory
    .filter((m) => m.domain === 'role-evidence' || m.kind === 'hypothesis')
    .map((m) => m.statement);

  const subscriptionQueries = (snapshot?.vacancySubscriptions ?? []).map((s) => s.query);
  const resumeTitle = snapshot?.resume?.draft?.targetRole;

  const targetRoles = Array.from(
    new Set(
      [...roleHypotheses, ...subscriptionQueries, ...(resumeTitle ? [resumeTitle] : [])].filter(
        Boolean,
      ),
    ),
  );

  return { confirmedSkills, targetRoles };
}

const matchedVacanciesQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Гипотезы роли считает сервер (B180, срез 1б).
 *
 * Браузеру считать было не из чего: страница подбора вырезает требования ради
 * байтового бюджета (INC-029), и на проде из 320 прочитанных записей они были
 * у нуля. Здесь пул полный, а наружу уходит готовый ответ в несколько сотен
 * байт — тот же бюджет перестаёт быть ограничением.
 */
const handleRoleHypotheses: Handler = async (
  { authService, candidateStore, config, multiSourceEngine, roleNamer },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;

  const { confirmedSkills, targetRoles } = readMatchProfile(candidateStore, candidate.id);
  // Без подтверждённого профиля подбора нет вовсе, а значит нет и рынка, по
  // которому можно назвать роль. Молчаливый пустой список сказал бы «рынок
  // ничего не назвал» там, где на самом деле некого спрашивать (B161).
  if (confirmedSkills.length === 0 && targetRoles.length === 0) {
    return {
      data: [],
      meta: {
        requestId: request.id,
        reason: 'candidate_profile_unconfirmed',
        poolSize: 0,
      },
    };
  }

  const matched = multiSourceEngine.getMatchedVacancies({
    candidateId: candidate.id,
    targetRoles,
    confirmedSkills,
    confirmedFacts: confirmedSkills,
    preferredRemote: true,
  });

  // Имя роли даёт модель, читающая факты кандидата; пул приписывает к нему
  // доказательство или честное «пока не найдено» (B180, срез 1в). Роль без
  // вакансий с экрана не убирается: отсутствие вакансий — состояние наших
  // источников, а не приговор роли (решение владельца 2026-09-03).
  // Язык названия решает код, а не модель: иначе смена провайдера переписывает
  // кандидату его же роли (B180, решение владельца 2026-09-03).
  const facts = candidateFacts(candidateStore, candidate.id);
  const { language } = resolveRoleNameLanguage({
    searchRegions: readSearchRegions(candidateStore, candidate.id),
    targetRoles,
    resumeText: facts.map((fact) => fact.statement).join(' '),
  });
  const naming = roleNamer
    ? await roleNamer.nameRoles(facts, language)
    : { roles: [] as NamedRole[] };

  return {
    data: buildRoleProposals({
      matched,
      named: naming.roles,
      candidateSkills: confirmedSkills,
    }),
    meta: {
      requestId: request.id,
      poolSize: matched.length,
      // Кто именно назвал роли и на каком языке: очередь из четырёх моделей
      // сдвигается молча, и без этого разница между 12 и 66 секундами на проде
      // не читается ниоткуда (B180).
      roleNaming: { stage: naming.stage ?? null, language },
    },
  };
};

/**
 * Рынки, на которых кандидат ищет, — его собственный ответ мастеру подбора.
 * Пустой список честен: он означает «ещё не сказал», а не «ищет везде».
 */
function readSearchRegions(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): CandidateRegion[] {
  const stored = candidateStore.getCandidateWorkspace(candidateId);
  if (!stored) return [];
  const parsed = candidateWorkspaceSchema.safeParse(stored);
  return parsed.success ? [...parsed.data.regions] : [];
}

/** Факты, по которым модель называет роль: своя ссылка у каждого. */
function candidateFacts(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): Array<{ ref: string; statement: string }> {
  return (candidateStore.getSnapshot(candidateId)?.memory ?? [])
    .filter((memory) => memory.status !== 'corrected')
    .map((memory) => ({ ref: `memory:${memory.id}`, statement: memory.statement }));
}

const handleMatchedVacancies: Handler = async (
  { authService, candidateStore, config, multiSourceEngine },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { offset } = matchedVacanciesQuerySchema.parse(request.query);

  const { confirmedSkills, targetRoles } = readMatchProfile(candidateStore, candidate.id);

  // Matching an invented profile produced «Подтверждённый навык: TypeScript»
  // for a candidate who confirmed nothing, and a match percentage computed
  // from it. No confirmed profile means no match claim (B161).
  if (confirmedSkills.length === 0 && targetRoles.length === 0) {
    return {
      data: [],
      meta: {
        requestId: request.id,
        reason: 'candidate_profile_unconfirmed',
        total: 0,
        offset,
        nextOffset: null,
      },
    };
  }

  const matched = multiSourceEngine.getMatchedVacancies({
    candidateId: candidate.id,
    targetRoles,
    confirmedSkills,
    confirmedFacts: confirmedSkills,
    preferredRemote: true,
  });

  // Весь подбор одним телом не доходит: маршрут рвёт ответ примерно на 20 460
  // байт (INC-029). Экран забирает пул страницами внутри доказанного бюджета.
  const page = buildMatchedVacancyPage(matched, offset);
  return {
    data: page.items,
    meta: {
      requestId: request.id,
      total: page.total,
      offset: page.offset,
      nextOffset: page.nextOffset,
    },
  };
};

const handleListSources: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  return {
    data: vacancySourceRegistryView(candidateStore.listVacancySourceHealth()),
    meta: { requestId: request.id },
  };
};

const handleListSubscriptions: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  return {
    data: candidateStore.listVacancySubscriptions(candidate.id),
    meta: { requestId: request.id },
  };
};

const handleCreateSubscription: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, vacancyIntelligence } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = vacancySubscriptionInputSchema.parse(request.body);
  const data = await vacancyIntelligence.createAndRefresh(candidate.id, body);
  return reply.code(201).send({
    data,
    meta: { requestId: request.id },
  });
};

function loadSubscription(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return null;
  const subscriptionId = z
    .string()
    .uuid()
    .parse((request.params as { subscriptionId: string }).subscriptionId);
  return { candidate, subscriptionId, subscription: candidateStore.getVacancySubscription(candidate.id, subscriptionId) };
}

const handleSubscriptionVacancies: Handler = async (deps, request, reply) => {
  const { candidateStore } = deps;
  const loaded = loadSubscription(deps, request, reply);
  if (!loaded) return undefined;
  if (!loaded.subscription) {
    return sendError(
      reply,
      request,
      SUBSCRIPTION_NOT_FOUND.status,
      SUBSCRIPTION_NOT_FOUND.code,
      SUBSCRIPTION_NOT_FOUND.message,
      false,
    );
  }
  return {
    data: {
      subscription: loaded.subscription,
      vacancies: candidateStore.listSubscriptionVacancies(loaded.candidate.id, loaded.subscriptionId),
    },
    meta: { requestId: request.id },
  };
};

const handleSetSubscriptionStatus: Handler = async (deps, request, reply) => {
  const { candidateStore } = deps;
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const loaded = loadSubscription(deps, request, reply);
  if (!loaded) return undefined;
  const body = z.object({ status: z.enum(['active', 'paused']) }).parse(request.body);
  const subscription = candidateStore.setVacancySubscriptionStatus(
    loaded.candidate.id,
    loaded.subscriptionId,
    body.status,
    new Date().toISOString(),
  );
  if (!subscription) {
    return sendError(
      reply,
      request,
      SUBSCRIPTION_NOT_FOUND.status,
      SUBSCRIPTION_NOT_FOUND.code,
      SUBSCRIPTION_NOT_FOUND.message,
      false,
    );
  }
  return { data: subscription, meta: { requestId: request.id } };
};

const handleRefreshSubscription: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, vacancyIntelligence } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const subscriptionId = z
    .string()
    .uuid()
    .parse((request.params as { subscriptionId: string }).subscriptionId);
  if (!candidateStore.getVacancySubscription(candidate.id, subscriptionId)) {
    return sendError(
      reply,
      request,
      SUBSCRIPTION_NOT_FOUND.status,
      SUBSCRIPTION_NOT_FOUND.code,
      SUBSCRIPTION_NOT_FOUND.message,
      false,
    );
  }
  return {
    data: await vacancyIntelligence.refreshCandidateSubscription(candidate.id, subscriptionId),
    meta: { requestId: request.id },
  };
};

const handleDeleteSubscription: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const subscriptionId = z
    .string()
    .uuid()
    .parse((request.params as { subscriptionId: string }).subscriptionId);
  if (!candidateStore.deleteVacancySubscription(candidate.id, subscriptionId)) {
    return sendError(
      reply,
      request,
      SUBSCRIPTION_NOT_FOUND.status,
      SUBSCRIPTION_NOT_FOUND.code,
      SUBSCRIPTION_NOT_FOUND.message,
      false,
    );
  }
  return reply.code(204).send();
};

export async function registerVacancyRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get(
    '/api/v1/market/hh',
    { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
    withDeps(deps, handleHhMarket),
  );
  app.get('/api/v1/candidate/matched-vacancies', withDeps(deps, handleMatchedVacancies));
  app.get('/api/v1/candidate/role-hypotheses', withDeps(deps, handleRoleHypotheses));
  app.get('/api/v1/candidate/vacancy-sources', withDeps(deps, handleListSources));
  app.get('/api/v1/candidate/vacancy-subscriptions', withDeps(deps, handleListSubscriptions));

  app.post(
    '/api/v1/candidate/vacancy-subscriptions',
    { config: { rateLimit: { max: 12, timeWindow: '1 hour' } } },
    withDeps(deps, handleCreateSubscription),
  );
  app.get(
    '/api/v1/candidate/vacancy-subscriptions/:subscriptionId/vacancies',
    withDeps(deps, handleSubscriptionVacancies),
  );
  app.patch(
    '/api/v1/candidate/vacancy-subscriptions/:subscriptionId',
    withDeps(deps, handleSetSubscriptionStatus),
  );
  app.post(
    '/api/v1/candidate/vacancy-subscriptions/:subscriptionId/refresh',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    withDeps(deps, handleRefreshSubscription),
  );
  app.delete(
    '/api/v1/candidate/vacancy-subscriptions/:subscriptionId',
    withDeps(deps, handleDeleteSubscription),
  );
}
