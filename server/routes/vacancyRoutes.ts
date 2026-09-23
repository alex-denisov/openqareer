import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { candidateWorkspaceSchema } from '../domain/candidateWorkspace';
import { resolveRoleNameLanguage, type RoleNameLanguage } from '../domain/roleNameLanguage';
import { dropOrganisationTitles } from '../domain/roleNaming';
import { markGeography } from '../vacancies/vacancyGeography';
import { vacancySubscriptionInputSchema } from '../domain/vacancy';
import type { CandidateRegion } from '../../src/features/workspace/candidateRegions';
import type { NamedRole, ProposedRole } from '../../shared/roleProposals';
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
  type StrategyConstraints,
  type StrategyRole,
} from '../../shared/careerStrategy';
import type { RoleNamingStageFailure } from '../providers/roleNamer';
import { buildMatchedVacancyPage } from '../vacancies/matchedVacancyPage';
import { MatchedPoolSnapshots } from '../vacancies/matchedPoolSnapshot';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { buildRoleProposals, confirmChosenTitle } from '../vacancies/roleHypotheses';
import { applyVacancyDecisions } from '../vacancies/applyVacancyDecisions';
import { deriveCandidateTargetLevel } from '../vacancies/candidateLevel';
import { countMatchedVacanciesByRole } from '../vacancies/vacancyRoleCounts';
import { campaignMeta, readCampaign } from './campaignContext';
import type { CampaignResolution } from '../vacancies/campaign';
import { registerCampaignRoutes } from './campaignRoutes';
import { vacancySourceRegistryView } from '../vacancies/vacancySourceRegistry';
import { generateVacancyPitch } from '../domain/vacancyPitchService';
import { registerRecruiterIntelligenceRoutes } from './recruiterIntelligenceRoutes';
import { registerApplicationRoutes } from './applicationRoutes';
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

/** Подтверждённые навыки кандидата — то, по чему вообще можно сопоставлять. */
function readMatchProfile(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): { confirmedSkills: string[] } {
  const snapshot = candidateStore.getSnapshot(candidateId);
  const memory = snapshot?.memory ?? [];
  const confirmedSkills = memory
    .filter(
      (m) => m.kind === 'fact' && (m.domain === 'skill' || m.confidence === 'candidate-confirmed'),
    )
    .map((m) => m.statement);

  return { confirmedSkills };
}

/**
 * Целевой уровень кандидата (B248, срез «подключение уровня»): роль кампании
 * важнее прошлой должности — кандидат вправе целиться выше своего опыта, и
 * fit-dot «уровень» обязан мерить его заявленную цель, а не только прошлое.
 */
function readTargetLevel(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  targetRoles: readonly string[],
) {
  const experience = candidateStore.getSnapshot(candidateId)?.resume?.draft.experience ?? [];
  return deriveCandidateTargetLevel({ targetRoles, experience });
}

/**
 * Отпечаток того, из чего считается подбор.
 *
 * Сменился профиль — сменился и снимок: иначе кандидат, подтвердивший навык,
 * дочитывал бы старый подбор до конца срока жизни снимка.
 */
function matchProfileKey(
  confirmedSkills: readonly string[],
  targetRoles: readonly string[],
): string {
  return createHash('sha256')
    .update(
      [[...confirmedSkills].sort().join('\u0000'), [...targetRoles].sort().join('\u0000')].join(
        '\u0001',
      ),
    )
    .digest('hex')
    .slice(0, 16);
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

// Ответы на задания меняют порядок ролей одного яруса и никогда — состав
// (B180, срез 3). Прогон по прежней версии ключа в счёт не идёт: смена
// формулировок меняет смысл сохранённых ответов.
function currentWorkPreferences(candidateStore: RouteDeps['candidateStore'], candidateId: string) {
  const run = candidateStore.getWorkPreferenceRun(candidateId);
  return run && run.keyVersion === WORK_PREFERENCE_KEY_VERSION ? run.result : undefined;
}

async function readRoleContext(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
): Promise<RoleContext | null> {
  const { candidateStore, multiSourceEngine, roleNamer, roleNamingFailures } = deps;
  const { confirmedSkills } = readMatchProfile(candidateStore, candidateId);
  const campaign = readCampaign(candidateStore, candidateId);
  const targetRoles = [...campaign.roles.value];
  // Без подтверждённого профиля подбора нет вовсе, а значит нет и рынка, по
  // которому можно назвать роль. Молчаливый пустой список сказал бы «рынок
  // ничего не назвал» там, где на самом деле некого спрашивать (B161).
  if (confirmedSkills.length === 0 && targetRoles.length === 0) return null;

  const targetLevel = readTargetLevel(candidateStore, candidateId, targetRoles);
  const matched = await readMatchedSnapshot(
    multiSourceEngine,
    candidateId,
    confirmedSkills,
    targetRoles,
    targetLevel,
  );

  // Имя роли даёт модель, читающая факты кандидата; пул приписывает к нему
  // доказательство или честное «пока не найдено» (B180, срез 1в). Роль без
  // вакансий с экрана не убирается: отсутствие вакансий — состояние наших
  // источников, а не приговор роли (решение владельца 2026-09-03).
  // Язык названия решает код, а не модель: иначе смена провайдера переписывает
  // кандидату его же роли (B180, решение владельца 2026-09-03).
  const facts = candidateFacts(candidateStore, candidateId);
  const regions = campaign.regions.value as CandidateRegion[];
  const { language } = resolveRoleNameLanguage({
    searchRegions: regions,
    targetRoles,
    resumeText: facts.map((fact) => fact.statement).join(' '),
  });
  const naming = roleNamer
    ? await roleNamer.nameRoles(facts, language)
    : { roles: [] as NamedRole[] };
  reportRoleNamingFailures(request, roleNamingFailures, naming.failures ?? []);
  // Работодатель из резюме — не роль, что бы модель ни ответила (PRB-039).
  const named = dropOrganisationTitles(
    naming.roles,
    candidateOrganisations(candidateStore, candidateId),
  );

  const preferences = currentWorkPreferences(candidateStore, candidateId);

  return {
    proposals: buildRoleProposals({
      matched,
      named,
      candidateSkills: confirmedSkills,
      ...(preferences ? { preferences } : {}),
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

/** Факты, по которым модель называет роль: своя ссылка у каждого. */
/** Организации кандидата по сохранённому резюме: работодатели и вузы. */
function candidateOrganisations(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): string[] {
  const draft = candidateStore.getSnapshot(candidateId)?.resume?.draft;
  if (!draft) return [];
  return [
    ...draft.experience.map((entry) => entry.employer ?? ''),
    ...draft.education.map((entry) => entry.institution ?? ''),
  ].filter((name) => name.trim().length > 0);
}

function candidateFacts(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
): Array<{ ref: string; statement: string }> {
  return (candidateStore.getSnapshot(candidateId)?.memory ?? [])
    .filter((memory) => memory.status !== 'corrected')
    .map((memory) => ({ ref: `memory:${memory.id}`, statement: memory.statement }));
}

/**
 * Снимки подбора живут на процессе: одно чтение пула — один список.
 *
 * Кабинет читает пул шестьюдесятью запросами (PRB-023), и пересчёт на каждый из
 * них стоил и времени, и правды: между страницами проходит опрос площадок, и
 * то же смещение указывает уже на другую запись (B211).
 */
const matchedPoolSnapshots = new WeakMap<RouteDeps['multiSourceEngine'], MatchedPoolSnapshots>();

function readMatchedSnapshot(
  engine: RouteDeps['multiSourceEngine'],
  candidateId: string,
  confirmedSkills: string[],
  targetRoles: string[],
  targetLevel: ReturnType<typeof deriveCandidateTargetLevel>,
): Promise<MatchedVacancyItem[]> {
  let snapshots = matchedPoolSnapshots.get(engine);
  if (!snapshots) {
    snapshots = new MatchedPoolSnapshots();
    matchedPoolSnapshots.set(engine, snapshots);
  }
  return snapshots.readAsync(
    candidateId,
    // Уровень входит в отпечаток снимка: смена целевой роли меняет и уровень,
    // и старый снимок с прежним fit-dot «уровень» не должен пережить это.
    `${matchProfileKey(confirmedSkills, targetRoles)}:${targetLevel ?? ''}`,
    () =>
      engine.getMatchedVacanciesAsync({
        candidateId,
        targetRoles,
        confirmedSkills,
        confirmedFacts: confirmedSkills,
        preferredRemote: true,
        ...(targetLevel ? { targetLevel } : {}),
      }),
  );
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
    return {
      data: [],
      meta: {
        requestId: request.id,
        reason: 'candidate_profile_unconfirmed',
        total: 0,
        offset,
        nextOffset: null,
        // Пустой пул — это одна страница, а не отсутствие плана: клиент читает
        // план первой страницы и не должен различать «нет плана» и «нечего
        // читать» (B211).
        ...(offset === 0 ? { pageOffsets: [0] } : {}),
        campaign: campaignMeta(campaign),
      },
    };
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
  const matched = finishMatchedVacancies(snapshot, targetRoles, campaign, candidateStore, candidate.id);
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

const handleGenerateVacancyPitch: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, multiSourceEngine } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;

  const vacancyId = (request.params as { id: string }).id;
  const body = vacancyPitchInputSchema.parse(request.body ?? {});

  const cluster = multiSourceEngine.getActiveCluster(vacancyId);
  const poolVacancy = !cluster ? multiSourceEngine.getVacancy?.(vacancyId) : undefined;

  const title = body?.vacancy?.title ?? cluster?.canonicalTitle ?? poolVacancy?.title;
  if (!title) {
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

  const snapshot = candidateStore.getSnapshot(candidate.id);
  const pitch = generateVacancyPitch({
    vacancy: {
      id: vacancyId,
      title,
      company: body?.vacancy?.company ?? cluster?.canonicalCompany ?? poolVacancy?.company,
      description:
        body?.vacancy?.description ?? cluster?.descriptionSummary ?? poolVacancy?.description,
      requiredSkills:
        body?.vacancy?.requiredSkills ?? cluster?.skills ?? poolVacancy?.requiredSkills ?? [],
      responsibilities: body?.vacancy?.responsibilities ?? poolVacancy?.responsibilities ?? [],
      location: body?.vacancy?.location ?? cluster?.canonicalLocation ?? poolVacancy?.location,
      isRemote: body?.vacancy?.isRemote ?? cluster?.isRemote ?? poolVacancy?.isRemote ?? false,
    },
    candidateName: snapshot?.resume?.draft?.candidate?.fullName,
    facts: snapshot?.memory ?? [],
    tone: body?.tone ?? 'executive',
  });

  if (body?.applicationId) {
    linkGeneratedCoverLetter(candidateStore, candidate.id, body.applicationId, pitch.atsCoverLetter);
  }

  return {
    data: pitch,
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
  app.get('/api/v1/candidate/role-hypotheses', withDeps(deps, handleRoleHypotheses));
  app.get('/api/v1/candidate/work-preferences', withDeps(deps, handleReadWorkPreferences));
  app.post(
    '/api/v1/candidate/work-preferences',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handleSubmitWorkPreferences),
  );
  registerVacancyApplicationRoutes(app, deps);
  registerApplicationRoutes(app, deps);
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
