import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { vacancySubscriptionInputSchema } from '../domain/vacancy';
import type { ProposedRole } from '../../shared/roleProposals';
import {
  MAX_EXCLUDED_FAMILIES,
  scoreWorkPreferences,
  WORK_FAMILIES,
  WORK_PREFERENCE_KEY_VERSION,
  WORK_PREFERENCE_TASKS,
  type WorkFamilyCode,
} from '../../shared/workPreferences';
import {
  candidateNamedStrategyRole,
  chooseStrategyRole,
  strategyRoleFromProposal,
  type StrategyRole,
} from '../../shared/careerStrategy';
import { confirmChosenTitle } from '../vacancies/roleHypotheses';
import { registerCampaignRoutes } from './campaignRoutes';
import { readRoleContext, type RoleContext } from './vacancyRoleContext';
import { vacancySourceRegistryView } from '../vacancies/vacancySourceRegistry';
import { registerRecruiterIntelligenceRoutes } from './recruiterIntelligenceRoutes';
import { registerApplicationRoutes } from './applicationRoutes';
import { registerMatchedVacancyRoutes } from './matchedVacancyRoutes';
import { registerVacancyPitchRoutes } from './vacancyPitchRoutes';
import { registerPlanRequestRoutes } from './planRequestRoutes';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { hhMarketQuerySchema } from './schemas';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

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

/**
 * Гипотезы роли считает сервер (B180, срез 1б).
 *
 * Браузеру считать было не из чего: страница подбора вырезает требования ради
 * байтового бюджета (INC-029), и на проде из 320 прочитанных записей они были
 * у нуля. Здесь пул полный, а наружу уходит готовый ответ в несколько сотен
 * байт — тот же бюджет перестаёт быть ограничением.
 */
const handleRoleHypotheses: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;

  const context = await readRoleContext(deps, request, candidate.id);
  if (!context) {
    return {
      data: [],
      meta: {
        requestId: request.id,
        reason: 'candidate_profile_unconfirmed',
        poolSize: 0,
      },
    };
  }

  return {
    data: context.proposals,
    meta: {
      requestId: request.id,
      poolSize: context.poolSize,
      // Кто именно назвал роли и на каком языке: очередь из четырёх моделей
      // сдвигается молча, и без этого разница между 12 и 66 секундами на проде
      // не читается ниоткуда (B180).
      roleNaming: { stage: context.namedBy, language: context.language },
    },
  };
};

/**
 * Ручной отклик (B165, срез 1, узлы 5, 6, 8, 9).
 *
 * Ничего не отправляет за кандидата: отклик уходит на площадке под его
 * собственной сессией (ADR-009), а продукт хранит только то, что кандидат
 * сделал сам, — ушёл по ссылке и подтвердил отклик.
 */
const vacancyApplicationSchema = z.object({
  clusterId: z.string().trim().min(1).max(200),
  status: z.enum(['opened', 'applied']),
  vacancy: z.object({
    title: z.string().trim().min(1).max(300),
    company: z.string().trim().max(300).default(''),
    // Только http(s): `javascript:` — тоже валидный URL, а снимок отклика
    // рано или поздно окажется ссылкой на экране.
    url: z
      .string()
      .trim()
      .url()
      .max(2000)
      .refine((value) => /^https?:\/\//iu.test(value), 'url_scheme_not_allowed'),
    source: z.string().trim().max(120).default(''),
  }),
});

const handleListVacancyApplications: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  return {
    data: deps.candidateStore.listVacancyApplications(candidate.id),
    meta: { requestId: request.id },
  };
};

const handleRecordVacancyApplication: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = vacancyApplicationSchema.parse(request.body);
  return {
    data: candidateStore.recordVacancyApplication(candidate.id, body),
    meta: { requestId: request.id },
  };
};

/**
 * Задания «Какие роли мне подходят» (B180, срез 3).
 *
 * Формулировки едут вместе с версией ключа: они версионируются вместе, и
 * результат, посчитанный по прежним словам, нельзя выдавать за результат по
 * новым. Правильных ответов нет — инструмент строит порядок, а не оценку.
 */
const handleReadWorkPreferences: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  return {
    data: {
      keyVersion: WORK_PREFERENCE_KEY_VERSION,
      tasks: WORK_PREFERENCE_TASKS,
      families: WORK_FAMILIES,
      maxExcluded: MAX_EXCLUDED_FAMILIES,
      // Отсутствие прогона — не ошибка: кандидат ещё не проходил задания.
      run: deps.candidateStore.getWorkPreferenceRun(candidate.id),
    },
    meta: { requestId: request.id },
  };
};

const workPreferenceSubmissionSchema = z.object({
  answers: z
    .array(
      z.object({
        taskId: z.string().trim().min(1).max(60),
        optionId: z.string().trim().min(1).max(60),
      }),
    )
    .max(WORK_PREFERENCE_TASKS.length),
  excluded: z
    .array(z.enum(WORK_FAMILIES.map((family) => family.code) as [string, ...string[]]))
    .max(WORK_FAMILIES.length)
    .default([]),
});

const handleSubmitWorkPreferences: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = workPreferenceSubmissionSchema.parse(request.body);
  const excluded = body.excluded as WorkFamilyCode[];

  const run = {
    keyVersion: WORK_PREFERENCE_KEY_VERSION,
    answers: body.answers,
    excluded,
    // Числа считает код: у каждого есть знаменатель, и сводного балла нет.
    result: scoreWorkPreferences({ answers: body.answers, excluded }),
    completedAt: new Date().toISOString(),
  };

  return {
    data: candidateStore.saveWorkPreferenceRun(candidate.id, run),
    meta: { requestId: request.id },
  };
};

/**
 * «Стратегия» — выбранная роль как версионированный объект (B180, срез 2).
 *
 * До этого среза выбранного направления не существовало: кампания «Поиск»
 * читала свободную строку мастера, которую никто не датировал и не объяснял, а
 * названная моделью роль нигде не сохранялась.
 */
const handleReadStrategy: Handler = async (deps, request, reply) => {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  return {
    // Отсутствие стратегии — не ошибка: кандидат ещё не выбирал.
    data: deps.candidateStore.getCareerStrategy(candidate.id),
    meta: { requestId: request.id },
  };
};

const strategyChoiceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  reason: z.string().trim().max(2_000).optional(),
});

const handleChooseStrategy: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = strategyChoiceSchema.parse(request.body);

  const context = await readRoleContext(deps, request, candidate.id);
  if (!context) {
    return sendError(
      reply,
      request,
      409,
      'candidate_profile_unconfirmed',
      'Пока профиль не подтверждён, выбирать роль не из чего.',
      false,
    );
  }

  const chosen = chooseStrategyRole({
    previous: candidateStore.getCareerStrategy(candidate.id),
    role: strategyRoleFor(context, body.title),
    constraints: context.constraints,
    reason: body.reason ?? null,
    decidedAt: new Date().toISOString(),
    provenance: {
      // Роль, названную самим кандидатом, не приписываем ступени очереди.
      namedBy: isProposed(context, body.title) ? context.namedBy : null,
      language: context.language,
      poolSize: context.poolSize,
    },
  });

  if (!chosen.ok) {
    return sendError(
      reply,
      request,
      400,
      'strategy_reason_required',
      'Смена роли обнуляет накопленную воронку — назовите причину, чтобы она осталась в истории.',
      false,
    );
  }

  return {
    data: candidateStore.saveCareerStrategy(candidate.id, chosen.strategy),
    meta: { requestId: request.id },
  };
};

/**
 * Роль вне предложенных не отклоняется: кандидат вправе назвать свою.
 *
 * Решение владельца 2026-09-03 по названию модели действует и здесь — имя, не
 * найденное ни у модели, ни в пуле, помечается, а не обесценивается.
 */
function strategyRoleFor(context: RoleContext, title: string): StrategyRole {
  const proposal = findProposal(context, title);
  return proposal
    ? strategyRoleFromProposal(proposal)
    : candidateNamedStrategyRole(
        title,
        confirmChosenTitle({
          matched: context.matched,
          title,
          candidateSkills: context.confirmedSkills,
        }),
      );
}

function findProposal(context: RoleContext, title: string): ProposedRole | undefined {
  const wanted = title.trim().toLowerCase();
  return context.proposals.find((role) => role.title.trim().toLowerCase() === wanted);
}

function isProposed(context: RoleContext, title: string): boolean {
  return findProposal(context, title) !== undefined;
}

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

function loadSubscription(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return null;
  const subscriptionId = z
    .string()
    .uuid()
    .parse((request.params as { subscriptionId: string }).subscriptionId);
  return {
    candidate,
    subscriptionId,
    subscription: candidateStore.getVacancySubscription(candidate.id, subscriptionId),
  };
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
      vacancies: candidateStore.listSubscriptionVacancies(
        loaded.candidate.id,
        loaded.subscriptionId,
      ),
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

/**
 * Full text of one vacancy for the in-app «Подробнее» (B266). The matched
 * list trims `descriptionSummary` for payload size; the source vacancy keeps
 * the full description under `cluster-<vacancyId>`, so one read serves it.
 */
/** Площадки вроде Jobicy до C05 клали выжимку и в полный текст: короткий текст с многоточием — не описание. */
const EXCERPT_MAX_CHARS = 600;
function looksLikeExcerpt(text: string): boolean {
  return text.length < EXCERPT_MAX_CHARS && /(?:…|\.\.\.)\s*$/u.test(text);
}

const handleVacancyDetail: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, multiSourceEngine } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const clusterId = (request.params as { id: string }).id;
  const cluster = multiSourceEngine.getActiveCluster(clusterId);
  const sourceId = clusterId.startsWith('cluster-')
    ? clusterId.slice('cluster-'.length)
    : clusterId;
  const loaded = await multiSourceEngine.loadVacancyDescription(sourceId);
  const full = loaded.vacancy ?? multiSourceEngine.getVacancy?.(sourceId);
  if (!cluster && !full) {
    if (multiSourceEngine.isKnownVacancyGone(clusterId)) {
      return sendError(reply, request, 410, 'vacancy_gone', 'Вакансия снята с площадки.', false);
    }
    return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  }
  const sourceDescriptions = [full?.fullDescription, full?.description]
    .map((value) => value?.trim() ?? '')
    .filter(Boolean);
  const description = sourceDescriptions.reduce(
    (longest, value) => (value.length > longest.length ? value : longest),
    '',
  );
  const truncated = loaded.unavailable || description.length === 0 || looksLikeExcerpt(description);
  return {
    data: {
      id: clusterId,
      description: description || cluster?.descriptionSummary?.trim() || '',
      truncated,
      ...(loaded.unavailable ? { unavailable: true } : {}),
      skills: cluster?.skills?.length ? cluster.skills : (full?.requiredSkills ?? []),
      responsibilities: full?.responsibilities ?? [],
    },
    meta: { requestId: request.id },
  };
};

/** Ручной отклик (B165, срез 1) — свои два маршрута, чтение и запись. */
function registerVacancyApplicationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/vacancy-applications', withDeps(deps, handleListVacancyApplications));
  app.post(
    '/api/v1/candidate/vacancy-applications',
    { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } },
    withDeps(deps, handleRecordVacancyApplication),
  );
}

/** Подписки на поисковые выборки (B175, B181). */
function registerVacancySubscriptionRoutes(app: FastifyInstance, deps: RouteDeps): void {
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

export async function registerVacancyRoutes(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.get(
    '/api/v1/market/hh',
    { config: { rateLimit: { max: 20, timeWindow: '5 minutes' } } },
    withDeps(deps, handleHhMarket),
  );
  app.get('/api/v1/candidate/vacancies/:id/detail', withDeps(deps, handleVacancyDetail));
  app.get('/api/v1/candidate/role-hypotheses', withDeps(deps, handleRoleHypotheses));
  app.get('/api/v1/candidate/work-preferences', withDeps(deps, handleReadWorkPreferences));
  app.post(
    '/api/v1/candidate/work-preferences',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handleSubmitWorkPreferences),
  );
  registerVacancyApplicationRoutes(app, deps);
  registerApplicationRoutes(app, deps);
  registerPlanRequestRoutes(app, deps);
  registerCampaignRoutes(app, deps);
  app.get('/api/v1/candidate/strategy', withDeps(deps, handleReadStrategy));
  app.post(
    '/api/v1/candidate/strategy',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handleChooseStrategy),
  );
  app.get('/api/v1/candidate/vacancy-sources', withDeps(deps, handleListSources));
  registerVacancySubscriptionRoutes(app, deps);
  registerRecruiterIntelligenceRoutes(app, deps);
  registerMatchedVacancyRoutes(app, deps);
  registerVacancyPitchRoutes(app, deps);
}
