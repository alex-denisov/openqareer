import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { candidateWorkspaceSchema } from '../domain/candidateWorkspace';
import { resolveRoleNameLanguage, type RoleNameLanguage } from '../domain/roleNameLanguage';
import { vacancySubscriptionInputSchema } from '../domain/vacancy';
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import type { NamedRole, ProposedRole } from '../../shared/roleProposals';
import {
  candidateNamedStrategyRole,
  chooseStrategyRole,
  strategyRoleFromProposal,
  type StrategyConstraints,
  type StrategyRole,
} from '../../shared/careerStrategy';
import type { RoleNamingStageFailure } from '../providers/roleNamer';
import { buildMatchedVacancyPage } from '../vacancies/matchedVacancyPage';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { buildRoleProposals, confirmChosenTitle } from '../vacancies/roleHypotheses';
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
 * Роли и всё, что о них известно, — один расчёт на два маршрута.
 *
 * Панель их показывает, выбор стратегии из них выбирает (B180, срез 2), и
 * считаться они обязаны одинаково: иначе кандидат выберет одну роль, а
 * сохранится другая. `null` означает ровно одно — спрашивать некого, потому
 * что профиль ещё не подтверждён (B161).
 */
interface RoleContext {
  readonly proposals: readonly ProposedRole[];
  readonly matched: readonly MatchedVacancyItem[];
  readonly poolSize: number;
  readonly namedBy: string | null;
  readonly language: RoleNameLanguage;
  readonly confirmedSkills: readonly string[];
  readonly constraints: StrategyConstraints;
}

async function readRoleContext(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
): Promise<RoleContext | null> {
  const { candidateStore, multiSourceEngine, roleNamer, roleNamingFailures } = deps;
  const { confirmedSkills, targetRoles } = readMatchProfile(candidateStore, candidateId);
  // Без подтверждённого профиля подбора нет вовсе, а значит нет и рынка, по
  // которому можно назвать роль. Молчаливый пустой список сказал бы «рынок
  // ничего не назвал» там, где на самом деле некого спрашивать (B161).
  if (confirmedSkills.length === 0 && targetRoles.length === 0) return null;

  const matched = multiSourceEngine.getMatchedVacancies({
    candidateId,
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
  const facts = candidateFacts(candidateStore, candidateId);
  const regions = readSearchRegions(candidateStore, candidateId);
  const { language } = resolveRoleNameLanguage({
    searchRegions: regions,
    targetRoles,
    resumeText: facts.map((fact) => fact.statement).join(' '),
  });
  const naming = roleNamer
    ? await roleNamer.nameRoles(facts, language)
    : { roles: [] as NamedRole[] };
  reportRoleNamingFailures(request, roleNamingFailures, naming.failures ?? []);

  return {
    proposals: buildRoleProposals({
      matched,
      named: naming.roles,
      candidateSkills: confirmedSkills,
    }),
    matched,
    poolSize: matched.length,
    namedBy: naming.stage ?? null,
    language,
    confirmedSkills,
    constraints: {
      regions,
      // Дословно то, что кандидат написал; код это не разбирает и не толкует.
      note: readConstraintNote(candidateStore, candidateId),
    },
  };
}

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

/** Ограничения кандидата — его собственный текст; пусто честнее выдуманного. */
function readConstraintNote(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): string | null {
  const stored = candidateStore.getCandidateWorkspace(candidateId);
  if (!stored) return null;
  const parsed = candidateWorkspaceSchema.safeParse(stored);
  const note = parsed.success ? parsed.data.constraints.trim() : '';
  return note.length > 0 ? note : null;
}

/**
 * Молчание ступени не роняет панель, но безымянным быть не должно: без кода
 * ответа исчерпанную квоту не отличить от таймаута тоннеля (INC-035).
 *
 * Кандидату причина не нужна — она уходит в лог сервера и в окно последних
 * отказов для администратора: прод-лог снаружи не читается.
 */
function reportRoleNamingFailures(
  request: FastifyRequest,
  log: RouteDeps['roleNamingFailures'],
  failures: readonly RoleNamingStageFailure[],
): void {
  for (const failure of failures) {
    request.log.warn(failure, 'role-naming-stage-failed');
  }
  log.record(failures);
}

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
  app.get('/api/v1/candidate/strategy', withDeps(deps, handleReadStrategy));
  app.post(
    '/api/v1/candidate/strategy',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handleChooseStrategy),
  );
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
