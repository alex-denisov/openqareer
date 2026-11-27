import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  evaluateCareerGoalRisk,
  type CareerDiaryGoal,
  type CareerDiaryGoalInput,
  type CareerDiaryGoalSummary,
} from '../../shared/careerDiary';
import {
  ADAPTATION_STAGES,
  ADAPTATION_STEPS,
  DEFAULT_GOAL_DETAILS,
  DIARY_NOTE_MAX,
  GOAL_INDICATORS_MAX,
  GOAL_SETTERS,
  type CareerDiaryAdaptationDetails,
  type CareerDiaryGoalCard,
  type CareerDiaryGoalCardInput,
  type CareerDiaryGoalCards,
  type CareerDiaryGoalDetails,
} from '../../shared/careerDiaryCards';
import { CareerDiaryIdempotencyConflictError } from '../data/sqliteCareerDiaryRepository';
import { SqliteDiaryCheckpointRepository } from '../data/sqliteDiaryCheckpointRepository';
import { SqliteDiaryDetailsRepository } from '../data/sqliteDiaryDetailsRepository';
import { SqliteGoalTaskSuggestionRepository } from '../data/sqliteGoalTaskSuggestionRepository';
import { SqliteKpiImportRepository } from '../data/sqliteKpiImportRepository';
import { careerDiaryPlanningSchema } from '../domain/careerDiaryAdaptation';
import { buildAdaptationView } from '../domain/careerDiaryAdaptationView';
import { cardRisk } from '../domain/careerDiaryCardRisk';
import { requireCabinetB640 } from './cabinetB640Flag';
import { registerCareerDiaryGoalTransferRoutes } from './careerDiaryGoalTransferRoutes';
import { registerCareerDiaryKpiRoutes } from './careerDiaryKpiRoutes';
import { registerCareerDiaryGoalHintRoutes } from './careerDiaryGoalHintRoutes';
import { registerCareerDiaryTaskSuggestionRoutes } from './careerDiaryTaskSuggestionRoutes';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B684: цель с показателями одним ответом и план адаптации с шестью шагами для кабинета
 * B640. Каждый маршрут начинается с `requireCabinetB640`: без флага адреса отвечают как
 * несуществующие. Прежние цели, планы и их маршруты не меняются: новые поля лежат рядом.
 */
export type CareerDiaryCardRouteDeps = RouteDeps & {
  readonly diaryDetailsRepository?: SqliteDiaryDetailsRepository;
  readonly kpiImportRepository?: SqliteKpiImportRepository;
  readonly taskSuggestionRepository?: SqliteGoalTaskSuggestionRepository;
};
type BoundDeps = RouteDeps & {
  readonly details: () => SqliteDiaryDetailsRepository;
  /** B687: отметка проверки на 30-й день — шаг d01 «пройдено» только с ней. */
  readonly marks: () => SqliteDiaryCheckpointRepository;
};
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const BASE = '/api/v1/candidate/career-diary';
const idSchema = z.string().uuid();
const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
  });
const note = z.string().trim().max(DIARY_NOTE_MAX);
const weightSchema = z.number().min(0).max(100);
const quarterTargetsSchema = z
  .array(
    z
      .object({
        quarter: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
        value: z.number().finite(),
      })
      .strict(),
  )
  .min(1)
  .max(4)
  .refine((items) => new Set(items.map((item) => item.quarter)).size === items.length)
  .transform((items) => [...items].sort((a, b) => a.quarter - b.quarter));
const valueSchema = z.union([z.number().finite(), z.boolean(), z.string().trim().min(1).max(500)]);
const indicatorSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    unit: z.string().trim().max(80),
    baselineValue: z.number().finite().nullable(),
    targetValue: valueSchema,
  })
  .strict();
const cardSchema = z
  .object({
    title: z.string().trim().min(1).max(240),
    type: z.enum(['operational', 'team', 'strategic', 'development']).optional(),
    horizon: z.enum(['quarter', 'next_quarter', 'year']),
    startDate: dateSchema,
    dueDate: dateSchema,
    setBy: z.enum(GOAL_SETTERS),
    agreedOn: dateSchema.nullish(),
    weight: weightSchema.nullish(),
    quarterTargets: quarterTargetsSchema.nullish(),
    indicators: z.array(indicatorSchema).min(1).max(GOAL_INDICATORS_MAX),
  })
  .strict()
  .refine((card) => card.dueDate >= card.startDate);
const detailsPatchSchema = z
  .object({
    setBy: z.enum(GOAL_SETTERS),
    agreedOn: dateSchema.nullable(),
    weight: weightSchema.nullable(),
    quarterTargets: quarterTargetsSchema.nullable(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);
const archiveSchema = z.object({ reason: note.min(1) }).strict();
const stageGoalSchema = z.object({ title: note.nullable(), goalId: idSchema.nullable() }).strict();
const adaptationPatchSchema = z
  .object({
    // Поля задачи правятся по одному; `null` вместо задачи убирает её детали целиком.
    tasks: z.record(
      z.string().min(1).max(80),
      z
        .object({
          step: z.enum(ADAPTATION_STEPS).nullable(),
          group: z.string().trim().min(1).max(120).nullable(),
          goalId: idSchema.nullable(),
        })
        .partial()
        .strict()
        .nullable(),
    ),
    stages: z
      .object(Object.fromEntries(ADAPTATION_STAGES.map((stage) => [stage, stageGoalSchema])))
      .partial()
      .strict(),
    probation: z.object({ endsOn: dateSchema.nullable(), reviewer: note.nullable() }).strict(),
    firstMeeting: z
      .object({
        heldOn: dateSchema.nullable(),
        expectations: note,
        successByDay90: note,
        measures: note,
        cadence: note,
        needsApproval: note,
        ownDecisions: note,
        manager: note,
      })
      .strict()
      .nullable(),
    relocated: z.boolean().nullable(),
  })
  .partial()
  .strict()
  .refine((patch) => Object.keys(patch).length > 0);

function invalid(reply: FastifyReply, request: FastifyRequest, fields?: Record<string, string>) {
  return sendError(
    reply,
    request,
    400,
    'invalid_career_diary_input',
    'Проверьте данные карьерного дневника.',
    false,
    fields,
  );
}

function missing(reply: FastifyReply, request: FastifyRequest) {
  return sendError(
    reply,
    request,
    404,
    'career_diary_record_not_found',
    'Запись дневника не найдена.',
    false,
  );
}

function candidateId(deps: BoundDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

function routeId(request: FastifyRequest, reply: FastifyReply, name: string): string | null {
  const parsed = idSchema.safeParse((request.params as Record<string, unknown>)[name]);
  if (parsed.success) return parsed.data;
  invalid(reply, request);
  return null;
}

const today = (): string => new Date().toISOString().slice(0, 10);

function summarize(
  deps: BoundDeps,
  candidate: string,
  goal: CareerDiaryGoal,
): CareerDiaryGoalSummary {
  const latestMeasurement =
    deps.candidateStore.careerDiaryRepo.listMeasurements(candidate, goal.id)[0] ?? null;
  return {
    ...goal,
    latestMeasurement,
    risk: evaluateCareerGoalRisk(goal, latestMeasurement, today()),
  };
}

/** Цели верхнего уровня с показателями внутри; цель без родителя в списке — тоже верхняя. */
function goalCards(deps: BoundDeps, candidate: string): CareerDiaryGoalCard[] {
  const goals = deps.candidateStore.careerDiaryRepo.listGoals(candidate);
  const ids = new Set(goals.map((goal) => goal.id));
  // Цель могли удалить прежним маршрутом: её детали здесь же и убираются.
  deps.details().dropGoalDetailsExcept(candidate, ids);
  const details = deps.details().goalDetails(candidate);
  return goals
    .filter((goal) => goal.parentGoalId === null || !ids.has(goal.parentGoalId))
    .map((goal) => {
      const own = summarize(deps, candidate, goal);
      const indicators = goals
        .filter((child) => child.parentGoalId === goal.id)
        .map((child) => summarize(deps, candidate, child));
      return {
        ...own,
        risk: cardRisk(
          own.risk,
          indicators.map((indicator) => indicator.risk),
        ),
        details: details.get(goal.id) ?? DEFAULT_GOAL_DETAILS,
        indicators,
      };
    });
}

function cardOf(deps: BoundDeps, candidate: string, goalId: string): CareerDiaryGoalCard | null {
  return goalCards(deps, candidate).find((card) => card.id === goalId) ?? null;
}

const listCards: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const cards = goalCards(deps, candidate);
  const data: CareerDiaryGoalCards = {
    items: cards.filter((card) => card.details.archive === null),
    archived: cards.filter((card) => card.details.archive !== null),
  };
  return { data, meta: { requestId: request.id } };
};

/**
 * Цель и её показатели. Показатель — всегда дочерняя цель, и один тоже: у него своё название
 * («Срок релиза, дней» у цели «Выпускать релиз за неделю»). Сама цель несёт значения первого
 * показателя, чтобы читаться прежними экранами, которые уже знают цели с разбиением.
 */
function createCard(
  deps: BoundDeps,
  candidate: string,
  input: CareerDiaryGoalCardInput,
  key: string,
): string {
  const repo = deps.candidateStore.careerDiaryRepo;
  const shared = {
    type: input.type ?? ('operational' as const),
    horizon: input.horizon,
    startDate: input.startDate,
    dueDate: input.dueDate,
  };
  const inputs: CareerDiaryGoalInput[] = input.indicators.map((indicator) => ({
    ...shared,
    ...indicator,
  }));
  const now = new Date().toISOString();
  const goal = repo.createGoal(candidate, { ...inputs[0], title: input.title }, now, key);
  repo.splitGoal(candidate, goal.id, inputs, now);
  if (!deps.details().goalDetails(candidate).has(goal.id)) {
    const details: CareerDiaryGoalDetails = {
      setBy: input.setBy,
      agreedOn: input.agreedOn ?? null,
      weight: input.weight ?? null,
      archive: null,
      quarterTargets: input.quarterTargets ?? null,
      transfer: null,
    };
    deps.details().saveGoalDetail(candidate, goal.id, details);
  }
  return goal.id;
}

const postCard: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const key = idSchema.safeParse(request.headers['idempotency-key']);
  if (!key.success) {
    return sendError(
      reply,
      request,
      400,
      'idempotency_key_required',
      'Для создания записи передайте Idempotency-Key в формате UUID.',
      false,
    );
  }
  const parsed = cardSchema.safeParse(request.body);
  if (!parsed.success) return invalid(reply, request);
  try {
    const goalId = createCard(deps, candidate, parsed.data, key.data);
    return reply
      .header('Location', `${BASE}/goals/${goalId}`)
      .code(201)
      .send({ data: cardOf(deps, candidate, goalId), meta: { requestId: request.id } });
  } catch (error) {
    if (!(error instanceof CareerDiaryIdempotencyConflictError)) throw error;
    return sendError(
      reply,
      request,
      409,
      'idempotency_key_reused',
      'Ключ идемпотентности уже использован с другими данными.',
      false,
    );
  }
};

/** Меняет детали цели верхнего уровня; `null` — такой цели у кандидата нет. */
function changeDetails(
  deps: BoundDeps,
  candidate: string,
  goalId: string,
  change: (details: CareerDiaryGoalDetails) => CareerDiaryGoalDetails,
): CareerDiaryGoalCard | null {
  const card = cardOf(deps, candidate, goalId);
  if (!card) return null;
  deps.details().saveGoalDetail(candidate, goalId, change(card.details));
  return cardOf(deps, candidate, goalId);
}

const patchCard: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const goalId = routeId(request, reply, 'goalId');
  if (!goalId) return undefined;
  const parsed = detailsPatchSchema.safeParse(request.body);
  if (!parsed.success) return invalid(reply, request);
  const card = changeDetails(deps, candidate, goalId, (details) => ({
    ...details,
    ...parsed.data,
  }));
  return card ? { data: card, meta: { requestId: request.id } } : missing(reply, request);
};

const archiveCard: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const goalId = routeId(request, reply, 'goalId');
  if (!goalId) return undefined;
  const parsed = archiveSchema.safeParse(request.body);
  if (!parsed.success) return invalid(reply, request);
  const archive = { archivedAt: new Date().toISOString(), reason: parsed.data.reason };
  const card = changeDetails(deps, candidate, goalId, (details) => ({ ...details, archive }));
  return card ? { data: card, meta: { requestId: request.id } } : missing(reply, request);
};

const restoreCard: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const goalId = routeId(request, reply, 'goalId');
  if (!goalId) return undefined;
  const card = changeDetails(deps, candidate, goalId, (details) => ({ ...details, archive: null }));
  return card ? { data: card, meta: { requestId: request.id } } : missing(reply, request);
};

/** Задачи прежнего плана места работы; `null` — плана нет или он не разобран. */
function planTasks(workplace: object) {
  const planning = careerDiaryPlanningSchema.safeParse(
    (workplace as { planning?: unknown }).planning,
  );
  return planning.success ? (planning.data.adaptationPlan?.tasks ?? null) : null;
}

function adaptationView(deps: BoundDeps, candidate: string, workplaceId: string) {
  const workplace = deps.candidateStore.careerDiaryRepo.getWorkplace(candidate, workplaceId);
  if (!workplace) return null;
  return buildAdaptationView({
    workplace,
    tasks: planTasks(workplace),
    details: deps.details().adaptationDetails(candidate, workplaceId),
    asOf: today(),
    day30Sent: deps.marks().get(candidate, workplaceId, 'day30').sentOn !== null,
  });
}

const getAdaptation: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const workplaceId = routeId(request, reply, 'workplaceId');
  if (!workplaceId) return undefined;
  const view = adaptationView(deps, candidate, workplaceId);
  return view ? { data: view, meta: { requestId: request.id } } : missing(reply, request);
};

/** Цели из правки, которых у кандидата нет. */
function unknownGoals(
  deps: BoundDeps,
  candidate: string,
  patch: z.infer<typeof adaptationPatchSchema>,
): boolean {
  const referenced = [
    ...Object.values(patch.tasks ?? {}).map((task) => task?.goalId ?? null),
    ...Object.values(patch.stages ?? {}).map((stage) => stage?.goalId ?? null),
  ].filter((id): id is string => id !== null);
  const repo = deps.candidateStore.careerDiaryRepo;
  return referenced.some((id) => repo.getGoal(candidate, id) === null);
}

type TaskDetailsMap = CareerDiaryAdaptationDetails['tasks'];

/**
 * Детали задач после правки: поля сливаются с прежними, `null` убирает детали задачи.
 * Детали задач, которых в плане уже нет, не копятся; плана нет или он не разобран
 * (`known === null`) — прежние детали остаются как есть.
 */
function mergeTasks(
  current: TaskDetailsMap,
  patch: Readonly<Record<string, TaskDetailsMap[string] | null>>,
  known: ReadonlySet<string> | null,
): TaskDetailsMap {
  const ids = new Set([...Object.keys(current), ...Object.keys(patch)]);
  const merged = new Map<string, TaskDetailsMap[string]>();
  for (const id of ids) {
    const change = Object.hasOwn(patch, id) ? patch[id] : undefined;
    const kept = Object.hasOwn(current, id) ? current[id] : undefined;
    if (change === null || (known && !known.has(id))) continue;
    merged.set(id, { ...kept, ...change });
  }
  return Object.fromEntries(merged);
}

const patchAdaptation: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const workplaceId = routeId(request, reply, 'workplaceId');
  if (!workplaceId) return undefined;
  const parsed = adaptationPatchSchema.safeParse(request.body);
  if (!parsed.success) return invalid(reply, request);
  const workplace = deps.candidateStore.careerDiaryRepo.getWorkplace(candidate, workplaceId);
  if (!workplace) return missing(reply, request);
  const plan = planTasks(workplace);
  const known = new Set((plan ?? []).map((task) => task.id));
  const patch = parsed.data;
  if (Object.keys(patch.tasks ?? {}).some((id) => !known.has(id))) {
    return invalid(reply, request, { tasks: 'Такой задачи в плане нет.' });
  }
  if (unknownGoals(deps, candidate, patch))
    return invalid(reply, request, { goalId: 'Такой цели нет.' });
  const current = deps.details().adaptationDetails(candidate, workplaceId);
  const next: CareerDiaryAdaptationDetails = {
    ...current,
    ...patch,
    tasks: mergeTasks(current.tasks, patch.tasks ?? {}, plan ? known : null),
    stages: { ...current.stages, ...patch.stages },
  };
  deps.details().saveAdaptationDetails(candidate, workplaceId, next);
  return { data: adaptationView(deps, candidate, workplaceId), meta: { requestId: request.id } };
};

export function registerCareerDiaryCardRoutes(
  app: FastifyInstance,
  deps: CareerDiaryCardRouteDeps,
): void {
  // Хранилище открывается при первом запросе под флагом: без флага база не трогается.
  let repository = deps.diaryDetailsRepository ?? null;
  const details = () => {
    repository ??= new SqliteDiaryDetailsRepository({
      databasePath: deps.config.databasePath,
      encryptionKey: deps.config.dataEncryptionKey,
    });
    return repository;
  };
  if (!deps.diaryDetailsRepository) app.addHook('onClose', async () => repository?.close());
  let checkpoints: SqliteDiaryCheckpointRepository | null = null;
  const marks = () =>
    (checkpoints ??= new SqliteDiaryCheckpointRepository({
      databasePath: deps.config.databasePath,
      encryptionKey: deps.config.dataEncryptionKey,
    }));
  app.addHook('onClose', async () => checkpoints?.close());
  const bound: BoundDeps = { ...deps, details, marks };
  const read = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
  const write = { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } };
  app.get(`${BASE}/goal-cards`, read, withDeps(bound, listCards));
  app.post(`${BASE}/goal-cards`, write, withDeps(bound, postCard));
  app.patch(`${BASE}/goal-cards/:goalId`, write, withDeps(bound, patchCard));
  app.put(`${BASE}/goal-cards/:goalId/archive`, write, withDeps(bound, archiveCard));
  app.delete(`${BASE}/goal-cards/:goalId/archive`, write, withDeps(bound, restoreCard));
  app.get(`${BASE}/workplaces/:workplaceId/adaptation`, read, withDeps(bound, getAdaptation));
  app.patch(`${BASE}/workplaces/:workplaceId/adaptation`, write, withDeps(bound, patchAdaptation));
  registerKpiRoutes(app, deps, bound);
  registerCareerDiaryTaskSuggestionRoutes(app, {
    ...deps,
    goalCard: (candidate, goalId) => cardOf(bound, candidate, goalId),
    goalTasks: (candidate, goalId) => goalPlanTasks(bound, candidate, goalId),
  });
  registerCareerDiaryGoalTransferRoutes(app, {
    candidateStore: deps.candidateStore,
    candidateId: (request, reply) => candidateId(bound, request, reply),
    goalId: (request, reply) => routeId(request, reply, 'goalId'),
    cardOf: (candidate, goalId) => cardOf(bound, candidate, goalId),
    saveTransfer: (candidate, goalId, transfer) =>
      changeDetails(bound, candidate, goalId, (details) => ({ ...details, transfer })),
    rateLimit: write,
  });
  registerCareerDiaryGoalHintRoutes(app, deps);
}

/** Задачи цели в плане основного места работы; `null` — основного места нет, задаче негде жить. */
function goalPlanTasks(deps: BoundDeps, candidate: string, goalId: string) {
  const primary = deps.candidateStore.careerDiaryRepo
    .listWorkplaces(candidate)
    .find((workplace) => workplace.isPrimary && workplace.status === 'active');
  const view = primary ? adaptationView(deps, candidate, primary.id) : null;
  return view
    ? view.stages.flatMap((stage) => stage.tasks).filter((task) => task.goalId === goalId)
    : null;
}

/** B686: загрузка KPI создаёт цели тем же путём, что и форма цели. */
function registerKpiRoutes(
  app: FastifyInstance,
  deps: CareerDiaryCardRouteDeps,
  bound: BoundDeps,
): void {
  let imports = deps.kpiImportRepository ?? null;
  const kpiImports = () => {
    imports ??= new SqliteKpiImportRepository({
      databasePath: deps.config.databasePath,
      encryptionKey: deps.config.dataEncryptionKey,
    });
    return imports;
  };
  if (!deps.kpiImportRepository) app.addHook('onClose', async () => imports?.close());
  registerCareerDiaryKpiRoutes(app, {
    ...deps,
    kpiImports,
    createCard: (candidate, input, key) => createCard(bound, candidate, input, key),
  });
}
