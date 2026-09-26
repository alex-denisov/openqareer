import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { markGeography } from '../vacancies/vacancyGeography';
import { vacancySubscriptionInputSchema } from '../domain/vacancy';
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
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
import { buildMatchedVacancyPage } from '../vacancies/matchedVacancyPage';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { confirmChosenTitle } from '../vacancies/roleHypotheses';
import { applyVacancyDecisions } from '../vacancies/applyVacancyDecisions';
import { countMatchedVacanciesByRole } from '../vacancies/vacancyRoleCounts';
import { campaignMeta, readCampaign } from './campaignContext';
import { unconfirmedCandidateMatchResponse } from './matchedVacancyResponse';
import type { CampaignResolution } from '../vacancies/campaign';
import { registerCampaignRoutes } from './campaignRoutes';
import { readRoleContext, readTargetLevel, type RoleContext } from './vacancyRoleContext';
import { readMatchedSnapshot, readMatchProfile } from '../vacancies/matchedPoolContext';
import { vacancySourceRegistryView } from '../vacancies/vacancySourceRegistry';
import {
  filterUsablePitchFacts,
  generateVacancyPitch,
  type PitchLanguage,
  type PitchTone,
  type VacancyPitchInputFact,
} from '../domain/vacancyPitchService';
import { COVER_LETTER_BUDGET_MS, withinTimeBudget } from '../providers/coverLetterWriter';
import type { PitchFactRankingContext } from '../domain/pitchFactRanking';
import { rulesParse } from '../vacancies/titleParse/rulesParse';
import { registerRecruiterIntelligenceRoutes } from './recruiterIntelligenceRoutes';
import { registerApplicationRoutes } from './applicationRoutes';
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
import { pitchRankingContext } from './pitchRankingContext';

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

/**
 * Everything that happens to the matched pool after its cache read: role and
 * geography filtering, then decisions (`saved`/`skip`) applied strictly
 * after the cache (architecture.md §4, §7) so a click never forces a full
 * pool recompute (B230/B247).
 */
function finishMatchedVacancies(
  snapshot: readonly MatchedVacancyItem[],
  targetRoles: readonly string[],
  campaign: CampaignResolution,
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): MatchedVacancyItem[] {
  // SQL добирает кандидатов до лимита любыми свежими записями; при названной
  // роли в подбор идут только совпавшие с ней, и счётчик считает их же.
  // Записи вне рынков кампании помечены и стоят после остальных (PRB-040).
  const roleFiltered = markGeography(
    targetRoles.length > 0
      ? snapshot.filter((item) => item.explanation.roleMatch !== 'none')
      : snapshot,
    campaign.regions.value as CandidateRegion[],
  );
  return applyVacancyDecisions(roleFiltered, candidateStore.listVacancyDecisions(candidateId));
}

const handleMatchedVacancies: Handler = async (
  { authService, candidateStore, config, multiSourceEngine },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { offset } = matchedVacanciesQuerySchema.parse(request.query);

  const { confirmedSkills } = readMatchProfile(candidateStore, candidate.id);
  const campaign = readCampaign(candidateStore, candidate.id);
  const targetRoles = [...campaign.roles.value];

  // Matching an invented profile produced «Подтверждённый навык: TypeScript»
  // for a candidate who confirmed nothing, and a match percentage computed
  // from it. No confirmed profile means no match claim (B161).
  if (confirmedSkills.length === 0 && targetRoles.length === 0) {
    return unconfirmedCandidateMatchResponse(request.id, offset, campaign);
  }

  // Подбор считается один раз на чтение: страницы одного чтения обязаны
  // приходить из одного списка, иначе смещение указывает не на ту запись.
  const targetLevel = readTargetLevel(candidateStore, candidate.id, targetRoles);
  const snapshot = await readMatchedSnapshot(
    multiSourceEngine,
    candidate.id,
    confirmedSkills,
    targetRoles,
    targetLevel,
  );
  const matched = finishMatchedVacancies(
    snapshot,
    targetRoles,
    campaign,
    candidateStore,
    candidate.id,
  );
  // Гипотеза роли (B247, срез 2): порог считается по тому же снимку, что и
  // сам подбор — до фильтра по роли/гео, иначе роль без вакансий в её же
  // рынке выглядела бы гипотезой из-за чужого фильтра, а не своего счёта.
  const vacancyCountsByRole = countMatchedVacanciesByRole(snapshot, targetRoles);
  const campaignWithHypotheses = readCampaign(candidateStore, candidate.id, vacancyCountsByRole);

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
      // Смещения всех страниц — только с первой: без них кабинет узнаёт, куда
      // идти дальше, лишь из предыдущего ответа, и держит канал 73 секунды
      // шестьюдесятью кругами подряд (PRB-023, B211).
      ...(page.pageOffsets ? { pageOffsets: page.pageOffsets } : {}),
      // Баннер расхождения профиль/кампания читает конкретные значения обеих
      // сторон отсюда, а не пересчитывает их сам (B247, срез 1). Гипотезы роли
      // едут в том же теле — экран «Вакансии» не пересчитывает порог сам.
      campaign: campaignMeta(campaignWithHypotheses),
      // Фильтр «уровень» экрана «Вакансии» подписывает свой чип тем же
      // значением, что и матчер, а не переспрашивает кандидата отдельно.
      candidateLevel: targetLevel ?? null,
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

const vacancyPitchInputSchema = z
  .object({
    tone: z.enum(['executive', 'confident', 'technical']).optional(),
    /** Overrides language auto-detected from the vacancy's own text (B266). */
    language: z.enum(['en', 'ru']).optional(),
    /**
     * B251, S2, architecture.md §4: when set, the generated cover letter is
     * saved to `candidate_documents` (`cover_letter`, `generated`) and linked
     * to this card. Without it the route behaves exactly as before.
     */
    applicationId: z.string().trim().min(1).max(200).optional(),
    vacancy: z
      .object({
        title: z.string().trim().min(1).optional(),
        company: z.string().trim().optional(),
        description: z.string().optional(),
        requiredSkills: z.array(z.string()).optional(),
        responsibilities: z.array(z.string()).optional(),
        location: z.string().optional(),
        isRemote: z.boolean().optional(),
      })
      .optional(),
  })
  .optional();

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
  const full = multiSourceEngine.getVacancy?.(sourceId);
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
  const truncated = description.length === 0 || looksLikeExcerpt(description);
  return {
    data: {
      id: clusterId,
      description: description || cluster?.descriptionSummary?.trim() || '',
      truncated,
      skills: cluster?.skills?.length ? cluster.skills : (full?.requiredSkills ?? []),
      responsibilities: full?.responsibilities ?? [],
    },
    meta: { requestId: request.id },
  };
};

/**
 * Модель пишет письмо, шаблон остаётся запасом (B266, пункт 7): пустой,
 * невалидный или упавший ответ не должен оставить кандидата без письма.
 */
async function writeCoverLetterBody(
  deps: RouteDeps,
  request: FastifyRequest,
  vacancy: {
    title: string;
    company?: string;
    description?: string;
    requiredSkills: readonly string[];
  },
  facts: readonly VacancyPitchInputFact[],
  language: PitchLanguage,
  tone: PitchTone,
  rankingContext?: PitchFactRankingContext,
): Promise<{ body?: string; stage?: string }> {
  const { coverLetterWriter } = deps;
  if (!coverLetterWriter) return {};
  const usableFacts = filterUsablePitchFacts(facts).map((fact) => ({
    ref: fact.id,
    statement: fact.statement,
    domain: fact.domain,
    createdAt: fact.createdAt,
    updatedAt: fact.updatedAt,
  }));
  const writing = coverLetterWriter.writeCoverLetter({
    facts: usableFacts,
    vacancy: {
      title: vacancy.title,
      ...(vacancy.company ? { company: vacancy.company } : {}),
      ...(vacancy.description ? { description: vacancy.description } : {}),
      requirements: vacancy.requiredSkills,
      ...(rankingContext ? { rankingContext } : {}),
    },
    language,
    tone,
  });
  const outcome = await withinTimeBudget(writing, COVER_LETTER_BUDGET_MS);
  if (outcome.failure) {
    // Причина отказа — для лога сервера, не для кандидата (тот же уговор,
    // что и у называния ролей); текст кандидата и ключ провайдера в лог не идут.
    request.log.warn(outcome.failure, 'cover-letter-stage-failed');
  }
  return outcome.body ? { body: outcome.body, stage: outcome.stage } : {};
}

/** Одна и та же вакансия собирается из тела запроса, кластера и пула один раз. */
function resolvePitchVacancy(
  body: z.infer<typeof vacancyPitchInputSchema>,
  vacancyId: string,
  cluster: ReturnType<RouteDeps['multiSourceEngine']['getActiveCluster']>,
  poolVacancy: ReturnType<NonNullable<RouteDeps['multiSourceEngine']['getVacancy']>> | undefined,
) {
  return {
    id: vacancyId,
    title: body?.vacancy?.title ?? cluster?.canonicalTitle ?? poolVacancy?.title,
    company: body?.vacancy?.company ?? cluster?.canonicalCompany ?? poolVacancy?.company,
    description:
      body?.vacancy?.description ?? cluster?.descriptionSummary ?? poolVacancy?.description,
    requiredSkills:
      body?.vacancy?.requiredSkills ?? cluster?.skills ?? poolVacancy?.requiredSkills ?? [],
    responsibilities: body?.vacancy?.responsibilities ?? poolVacancy?.responsibilities ?? [],
    location: body?.vacancy?.location ?? cluster?.canonicalLocation ?? poolVacancy?.location,
    isRemote: body?.vacancy?.isRemote ?? cluster?.isRemote ?? poolVacancy?.isRemote ?? false,
  };
}

/** 404/410 — вакансия снята или её не было вовсе; текст отличает их для кандидата. */
function vacancyNotFoundResponse(
  reply: FastifyReply,
  request: FastifyRequest,
  multiSourceEngine: RouteDeps['multiSourceEngine'],
  vacancyId: string,
) {
  if (multiSourceEngine.isKnownVacancyGone(vacancyId)) {
    return sendError(
      reply,
      request,
      410,
      'vacancy_gone',
      'Вакансия снята или обновилась — обновите список.',
      false,
    );
  }
  return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
}

const handleGenerateVacancyPitch: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, multiSourceEngine } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  const body = vacancyPitchInputSchema.parse(request.body ?? {});

  const cluster = multiSourceEngine.getActiveCluster(vacancyId);
  const poolVacancy = !cluster ? multiSourceEngine.getVacancy?.(vacancyId) : undefined;
  const vacancy = resolvePitchVacancy(body, vacancyId, cluster, poolVacancy);
  if (!vacancy.title) {
    return vacancyNotFoundResponse(reply, request, multiSourceEngine, vacancyId);
  }
  const title = vacancy.title;
  const pitchVacancy = { ...vacancy, title };
  const rankingContext = pitchRankingContext(
    candidateStore,
    deps.titleParseStore,
    candidate.id,
    title,
  );

  const snapshot = candidateStore.getSnapshot(candidate.id);
  const facts = snapshot?.memory ?? [];
  const tone = body?.tone ?? 'executive';
  const pitch = generateVacancyPitch({
    vacancy: pitchVacancy,
    candidateName: snapshot?.resume?.draft?.candidate?.fullName,
    facts,
    tone,
    ...(rankingContext ? { rankingContext } : {}),
    ...(body?.language ? { language: body.language } : {}),
  });

  const written = await writeCoverLetterBody(
    deps,
    request,
    pitchVacancy,
    facts,
    pitch.language,
    tone,
    rankingContext,
  );
  const atsCoverLetter = written.body ?? pitch.atsCoverLetter;
  if (body?.applicationId) {
    linkGeneratedCoverLetter(candidateStore, candidate.id, body.applicationId, atsCoverLetter);
  }
  return {
    data: {
      ...pitch,
      atsCoverLetter,
      bodySource: written.body ? ('model' as const) : ('template' as const),
      ...(written.body && written.stage ? { stage: written.stage } : {}),
    },
    meta: { requestId: request.id },
  };
};

/**
 * Saves the generated letter to `candidate_documents` and links it to the
 * card (architecture.md §4). Throws `ApplicationNotFoundError` if the card
 * is not the candidate's own — the generic error mapper turns that into 404.
 */
function linkGeneratedCoverLetter(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  applicationId: string,
  coverLetterText: string,
): void {
  const { document } = candidateStore.saveDocument(candidateId, {
    kind: 'cover_letter',
    source: 'generated',
    fileName: 'cover-letter.txt',
    mimeType: 'text/plain',
    contentBase64: Buffer.from(coverLetterText, 'utf8').toString('base64'),
    parseStatus: 'not_applicable',
  });
  candidateStore.linkApplicationMaterial(candidateId, applicationId, 'cover_letter', document.id);
}

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
  app.get('/api/v1/candidate/matched-vacancies', withDeps(deps, handleMatchedVacancies));
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
  app.post(
    '/api/v1/candidate/vacancies/:id/pitch',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleGenerateVacancyPitch),
  );
}
