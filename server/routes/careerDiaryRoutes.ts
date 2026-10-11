import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { evaluateCareerGoalRisk } from '../../shared/careerDiary';
import type {
  CareerDiaryAchievement,
  CareerDiaryGoal,
  CareerDiaryGoalSummary,
  CareerDiaryMeasurement,
  CareerDiaryWorkplace,
} from '../../shared/careerDiary';
import { careerDiaryPlanningSchema, careerDiaryQuarterDecisionSchema } from '../domain/careerDiaryAdaptation';
import type { RouteDeps } from './deps';
import {
  CareerDiaryIdempotencyConflictError,
  InvalidCareerDiaryCursorError,
} from '../data/sqliteCareerDiaryRepository';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const timestamp = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
});
const weekStartSchema = dateSchema.refine(
  (value) => new Date(value + 'T00:00:00.000Z').getUTCDay() === 1,
  'week_start_must_be_monday',
);
const diaryIdSchema = z.string().uuid();
const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(300).optional(),
}).strict();
const valueSchema = z.union([
  z.number().finite(),
  z.boolean(),
  z.string().trim().min(1).max(500),
]);

const goalFieldsSchema = z.object({
  title: z.string().trim().min(1).max(240),
  type: z.enum(['operational', 'team', 'strategic', 'development']),
  horizon: z.enum(['quarter', 'next_quarter', 'year']),
  startDate: dateSchema,
  dueDate: dateSchema,
  unit: z.string().trim().min(1).max(80),
  baselineValue: z.number().finite().nullable(),
  targetValue: valueSchema,
  parentGoalId: diaryIdSchema.nullable().optional(),
}).strict();

const goalInputSchema = goalFieldsSchema.refine(
  (value) => value.dueDate >= value.startDate,
  'due_date_before_start',
);
const goalPatchSchema = goalFieldsSchema.partial().extend({
  quarterDecision: careerDiaryQuarterDecisionSchema.optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0 &&
    (!value.startDate || !value.dueDate || value.dueDate >= value.startDate),
  'invalid_goal_patch',
);

const splitGoalSchema = z.object({
  children: z.array(goalInputSchema).min(2).max(10),
}).strict();

const measurementSchema = z.object({
  value: valueSchema,
  measuredAt: dateSchema,
  note: z.string().trim().max(2000).nullable().optional(),
}).strict();

const weeklyReviewInputSchema = z.object({
  movedForward: z.string().trim().max(4000).default(''),
  blockers: z.string().trim().max(4000).default(''),
  learning: z.string().trim().max(4000).default(''),
  risks: z.string().trim().max(4000).default(''),
  nextWeek: z.string().trim().max(4000).default(''),
}).strict();

const achievementSchema = z.object({
  situation: z.string().trim().min(1).max(3000),
  action: z.string().trim().min(1).max(3000),
  result: z.string().trim().min(1).max(3000),
}).strict();

const achievementStatusSchema = z.object({
  status: z.enum(['ready_to_add', 'dismissed']),
}).strict();

const workplaceFieldsSchema = z.object({
  company: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(240),
  startDate: dateSchema,
  endDate: dateSchema.nullable().optional(),
  sourceExperienceId: z.string().trim().max(200).nullable().optional(),
}).strict();

const workplaceSchema = workplaceFieldsSchema.refine(
  (value) => !value.endDate || value.endDate >= value.startDate,
  'end_date_before_start',
);
const workplacePatchSchema = workplaceFieldsSchema.partial().extend({
  planning: careerDiaryPlanningSchema.optional(),
}).strict().refine(
  (value) => Object.keys(value).length > 0 &&
    (!value.startDate || !value.endDate || value.endDate === null || value.endDate >= value.startDate),
  'invalid_workplace_patch',
);

function pageQuery(
  request: FastifyRequest,
  reply: FastifyReply,
): z.infer<typeof listQuerySchema> | null {
  const parsed = listQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    invalidInput(reply, request);
    return null;
  }
  return parsed.data;
}

function pagedResponse(
  request: FastifyRequest,
  reply: FastifyReply,
  readPage: () => unknown,
) {
  try {
    return { data: readPage(), meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof InvalidCareerDiaryCursorError) return invalidInput(reply, request);
    throw error;
  }
}

function idempotencyKey(request: FastifyRequest, reply: FastifyReply): string | null {
  const parsed = z.string().uuid().safeParse(request.headers['idempotency-key']);
  if (!parsed.success) {
    sendError(
      reply,
      request,
      400,
      'idempotency_key_required',
      'Для создания записи передайте Idempotency-Key в формате UUID.',
      false,
    );
    return null;
  }
  return parsed.data;
}

function idempotencyConflict(reply: FastifyReply, request: FastifyRequest) {
  return sendError(
    reply,
    request,
    409,
    'idempotency_key_reused',
    'Ключ идемпотентности уже использован с другими данными.',
    false,
  );
}

function candidateForRequest(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  write = false,
) {
  const { authService, candidateStore, config } = deps;
  if (write && !hasSafeMutationOrigin(request, config)) {
    csrfError(request, reply);
    return null;
  }
  return authenticateCandidate(request, reply, candidateStore, authService, config);
}

function invalidInput(reply: FastifyReply, request: FastifyRequest) {
  return sendError(
    reply,
    request,
    400,
    'invalid_career_diary_input',
    'Проверьте данные карьерного дневника.',
    false,
  );
}

function missingRecord(reply: FastifyReply, request: FastifyRequest) {
  return sendError(reply, request, 404, 'career_diary_record_not_found', 'Запись дневника не найдена.', false);
}

function routeId(request: FastifyRequest, reply: FastifyReply, key: string): string | null {
  const value = (request.params as Record<string, unknown>)[key];
  const parsed = diaryIdSchema.safeParse(value);
  if (!parsed.success) {
    invalidInput(reply, request);
    return null;
  }
  return parsed.data;
}

function summarizeGoal(
  deps: RouteDeps,
  candidateId: string,
  goal: CareerDiaryGoal,
  asOf: string,
): CareerDiaryGoalSummary {
  const measurements = deps.candidateStore.careerDiaryRepo.listMeasurements(candidateId, goal.id);
  const latestMeasurement = measurements[0] ?? null;
  return {
    ...goal,
    latestMeasurement,
    risk: evaluateCareerGoalRisk(goal, latestMeasurement, asOf),
  };
}

const handleOverview: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply);
  if (!candidate) return undefined;
  return {
    data: deps.candidateStore.careerDiaryRepo.getOverview(
      candidate.id,
      new Date().toISOString().slice(0, 10),
    ),
    meta: { requestId: request.id },
  };
};

const handleListGoals: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply);
  if (!candidate) return undefined;
  const query = pageQuery(request, reply);
  if (!query) return undefined;
  const asOf = new Date().toISOString().slice(0, 10);
  return pagedResponse(request, reply, () => {
    const page = deps.candidateStore.careerDiaryRepo.listGoalsPage(candidate.id, query.limit, query.cursor);
    return {
      items: page.items.map((goal) => summarizeGoal(deps, candidate.id, goal, asOf)),
      nextCursor: page.nextCursor,
    };
  });
};

const handleCreateGoal: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const key = idempotencyKey(request, reply);
  if (!key) return undefined;
  const parsed = goalInputSchema.safeParse(request.body);
  if (!parsed.success) return invalidInput(reply, request);
  let goal: CareerDiaryGoal;
  try {
    goal = deps.candidateStore.careerDiaryRepo.createGoal(
      candidate.id,
      parsed.data,
      new Date().toISOString(),
      key,
    );
  } catch (error) {
    if (error instanceof CareerDiaryIdempotencyConflictError) return idempotencyConflict(reply, request);
    throw error;
  }
  return reply
    .header('Location', '/api/v1/candidate/career-diary/goals/' + goal.id)
    .code(201)
    .send({
      data: summarizeGoal(deps, candidate.id, goal, new Date().toISOString().slice(0, 10)),
      meta: { requestId: request.id },
    });
};

const handleGetGoal: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply);
  if (!candidate) return undefined;
  const goalId = routeId(request, reply, 'goalId');
  if (!goalId) return undefined;
  const goal = deps.candidateStore.careerDiaryRepo.getGoal(candidate.id, goalId);
  if (!goal) return missingRecord(reply, request);
  return {
    data: summarizeGoal(deps, candidate.id, goal, new Date().toISOString().slice(0, 10)),
    meta: { requestId: request.id },
  };
};

const handleUpdateGoal: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const goalId = routeId(request, reply, 'goalId');
  if (!goalId) return undefined;
  const parsed = goalPatchSchema.safeParse(request.body);
  if (!parsed.success) return invalidInput(reply, request);
  const current = deps.candidateStore.careerDiaryRepo.getGoal(candidate.id, goalId);
  if (!current) return missingRecord(reply, request);
  const startDate = parsed.data.startDate ?? current.startDate;
  const dueDate = parsed.data.dueDate ?? current.dueDate;
  if (dueDate < startDate) return invalidInput(reply, request);
  const goal = deps.candidateStore.careerDiaryRepo.updateGoal(candidate.id, goalId, parsed.data);
  if (!goal) return missingRecord(reply, request);
  return { data: goal, meta: { requestId: request.id } };
};

const handleDeleteGoal: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const goalId = routeId(request, reply, 'goalId');
  if (!goalId) return undefined;
  if (!deps.candidateStore.careerDiaryRepo.deleteGoal(candidate.id, goalId)) {
    return missingRecord(reply, request);
  }
  return { data: { id: goalId, deleted: true }, meta: { requestId: request.id } };
};

const handleSetPrimaryGoal: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const goalId = routeId(request, reply, 'goalId');
  if (!goalId) return undefined;
  const goal = deps.candidateStore.careerDiaryRepo.setPrimaryGoal(candidate.id, goalId);
  if (!goal) return missingRecord(reply, request);
  return { data: goal, meta: { requestId: request.id } };
};

const handleSplitGoal: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const goalId = routeId(request, reply, 'goalId');
  if (!goalId) return undefined;
  const parsed = splitGoalSchema.safeParse(request.body);
  if (!parsed.success) return invalidInput(reply, request);
  try {
    const goals = deps.candidateStore.careerDiaryRepo.splitGoal(candidate.id, goalId, parsed.data.children);
    if (!goals) return missingRecord(reply, request);
    return { data: goals, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof CareerDiaryIdempotencyConflictError) return idempotencyConflict(reply, request);
    throw error;
  }
};

const handleGetMeasurement: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply);
  if (!candidate) return undefined;
  const goalId = routeId(request, reply, 'goalId');
  const measurementId = routeId(request, reply, 'measurementId');
  if (!goalId || !measurementId) return undefined;
  const measurement = deps.candidateStore.careerDiaryRepo.getMeasurement(
    candidate.id,
    goalId,
    measurementId,
  );
  if (!measurement) return missingRecord(reply, request);
  return { data: measurement, meta: { requestId: request.id } };
};

const handleListMeasurements: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply);
  if (!candidate) return undefined;
  const goalId = routeId(request, reply, 'goalId');
  if (!goalId) return undefined;
  if (!deps.candidateStore.careerDiaryRepo.getGoal(candidate.id, goalId)) {
    return missingRecord(reply, request);
  }
  const query = pageQuery(request, reply);
  if (!query) return undefined;
  return pagedResponse(request, reply, () =>
    deps.candidateStore.careerDiaryRepo.listMeasurementsPage(
      candidate.id,
      goalId,
      query.limit,
      query.cursor,
    ),
  );
};

const handleRecordMeasurement: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const goalId = routeId(request, reply, 'goalId');
  if (!goalId) return undefined;
  const key = idempotencyKey(request, reply);
  if (!key) return undefined;
  const parsed = measurementSchema.safeParse(request.body);
  if (!parsed.success) return invalidInput(reply, request);
  let measurement: CareerDiaryMeasurement | null;
  try {
    measurement = deps.candidateStore.careerDiaryRepo.recordMeasurement(
      candidate.id,
      goalId,
      parsed.data,
      new Date().toISOString(),
      key,
    );
  } catch (error) {
    if (error instanceof CareerDiaryIdempotencyConflictError) return idempotencyConflict(reply, request);
    throw error;
  }
  if (!measurement) return missingRecord(reply, request);
  return reply
    .header('Location', '/api/v1/candidate/career-diary/goals/' + goalId + '/measurements/' + measurement.id)
    .code(201)
    .send({ data: measurement, meta: { requestId: request.id } });
};

const handleListReviews: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply);
  if (!candidate) return undefined;
  const query = pageQuery(request, reply);
  if (!query) return undefined;
  return pagedResponse(request, reply, () =>
    deps.candidateStore.careerDiaryRepo.listWeeklyReviewsPage(
      candidate.id,
      query.limit,
      query.cursor,
    ),
  );
};

const handleGetReview: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply);
  if (!candidate) return undefined;
  const weekStart = weekStartSchema.safeParse((request.params as { weekStart?: unknown }).weekStart);
  if (!weekStart.success) return invalidInput(reply, request);
  const review = deps.candidateStore.careerDiaryRepo.getWeeklyReview(candidate.id, weekStart.data);
  if (!review) return missingRecord(reply, request);
  return { data: review, meta: { requestId: request.id } };
};

const handleUpsertReview: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const weekStart = weekStartSchema.safeParse((request.params as { weekStart?: unknown }).weekStart);
  if (!weekStart.success) return invalidInput(reply, request);
  const parsed = weeklyReviewInputSchema.safeParse(request.body);
  if (!parsed.success) return invalidInput(reply, request);
  const review = deps.candidateStore.careerDiaryRepo.upsertWeeklyReview(candidate.id, { ...parsed.data, weekStart: weekStart.data });
  return { data: review, meta: { requestId: request.id } };
};

const handleDeleteReview: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const weekStart = weekStartSchema.safeParse((request.params as { weekStart?: unknown }).weekStart);
  if (!weekStart.success) return invalidInput(reply, request);
  if (!deps.candidateStore.careerDiaryRepo.deleteWeeklyReview(candidate.id, weekStart.data)) {
    return missingRecord(reply, request);
  }
  return { data: { weekStart: weekStart.data, deleted: true }, meta: { requestId: request.id } };
};

const handleGetAchievement: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply);
  if (!candidate) return undefined;
  const achievementId = routeId(request, reply, 'achievementId');
  if (!achievementId) return undefined;
  const achievement = deps.candidateStore.careerDiaryRepo.getAchievement(candidate.id, achievementId);
  if (!achievement) return missingRecord(reply, request);
  return { data: achievement, meta: { requestId: request.id } };
};

const handleListAchievements: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply);
  if (!candidate) return undefined;
  const query = pageQuery(request, reply);
  if (!query) return undefined;
  return pagedResponse(request, reply, () =>
    deps.candidateStore.careerDiaryRepo.listAchievementsPage(
      candidate.id,
      query.limit,
      query.cursor,
    ),
  );
};

const handleCreateAchievement: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const key = idempotencyKey(request, reply);
  if (!key) return undefined;
  const parsed = achievementSchema.safeParse(request.body);
  if (!parsed.success) return invalidInput(reply, request);
  let achievement: CareerDiaryAchievement;
  try {
    achievement = deps.candidateStore.careerDiaryRepo.createAchievement(
      candidate.id,
      parsed.data,
      new Date().toISOString(),
      key,
    );
  } catch (error) {
    if (error instanceof CareerDiaryIdempotencyConflictError) return idempotencyConflict(reply, request);
    throw error;
  }
  return reply
    .header('Location', '/api/v1/candidate/career-diary/achievements/' + achievement.id)
    .code(201)
    .send({ data: achievement, meta: { requestId: request.id } });
};

const handleUpdateAchievement: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const achievementId = routeId(request, reply, 'achievementId');
  if (!achievementId) return undefined;
  const parsed = achievementStatusSchema.safeParse(request.body);
  if (!parsed.success) return invalidInput(reply, request);
  const achievement = deps.candidateStore.careerDiaryRepo.setAchievementStatus(
    candidate.id,
    achievementId,
    parsed.data.status,
  );
  if (!achievement) return missingRecord(reply, request);
  return { data: achievement, meta: { requestId: request.id } };
};

const handleGetWorkplace: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply);
  if (!candidate) return undefined;
  const workplaceId = routeId(request, reply, 'workplaceId');
  if (!workplaceId) return undefined;
  const workplace = deps.candidateStore.careerDiaryRepo.getWorkplace(candidate.id, workplaceId);
  if (!workplace) return missingRecord(reply, request);
  return { data: workplace, meta: { requestId: request.id } };
};

const handleListWorkplaces: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply);
  if (!candidate) return undefined;
  const query = pageQuery(request, reply);
  if (!query) return undefined;
  return pagedResponse(request, reply, () =>
    deps.candidateStore.careerDiaryRepo.listWorkplacesPage(
      candidate.id,
      query.limit,
      query.cursor,
    ),
  );
};

const handleCreateWorkplace: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const key = idempotencyKey(request, reply);
  if (!key) return undefined;
  const parsed = workplaceSchema.safeParse(request.body);
  if (!parsed.success) return invalidInput(reply, request);
  let workplace: CareerDiaryWorkplace;
  try {
    workplace = deps.candidateStore.careerDiaryRepo.createWorkplace(
      candidate.id,
      parsed.data,
      new Date().toISOString(),
      key,
    );
  } catch (error) {
    if (error instanceof CareerDiaryIdempotencyConflictError) return idempotencyConflict(reply, request);
    throw error;
  }
  return reply
    .header('Location', '/api/v1/candidate/career-diary/workplaces/' + workplace.id)
    .code(201)
    .send({ data: workplace, meta: { requestId: request.id } });
};

const handleUpdateWorkplace: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const workplaceId = routeId(request, reply, 'workplaceId');
  if (!workplaceId) return undefined;
  const parsed = workplacePatchSchema.safeParse(request.body);
  if (!parsed.success) return invalidInput(reply, request);
  const current = deps.candidateStore.careerDiaryRepo.listWorkplaces(candidate.id)
    .find((item) => item.id === workplaceId);
  if (!current) return missingRecord(reply, request);
  if (parsed.data.planning && current.status === 'archived') {
    return sendError(
      reply,
      request,
      409,
      'career_diary_workplace_archived',
      'Архивное место работы доступно только для чтения.',
      false,
    );
  }
  if (parsed.data.planning?.adaptationPlan?.workplaceId !== undefined &&
      parsed.data.planning.adaptationPlan.workplaceId !== workplaceId) {
    return invalidInput(reply, request);
  }
  const startDate = parsed.data.startDate ?? current.startDate;
  const endDate = parsed.data.endDate === undefined ? current.endDate : parsed.data.endDate;
  if (endDate && endDate < startDate) return invalidInput(reply, request);
  const workplace = deps.candidateStore.careerDiaryRepo.updateWorkplace(
    candidate.id,
    workplaceId,
    parsed.data,
  );
  if (!workplace) return missingRecord(reply, request);
  return { data: workplace, meta: { requestId: request.id } };
};

const handleSetPrimaryWorkplace: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const workplaceId = routeId(request, reply, 'workplaceId');
  if (!workplaceId) return undefined;
  const workplace = deps.candidateStore.careerDiaryRepo.setPrimaryWorkplace(candidate.id, workplaceId);
  if (!workplace) return missingRecord(reply, request);
  return { data: workplace, meta: { requestId: request.id } };
};

const handleArchiveWorkplace: Handler = async (deps, request, reply) => {
  const candidate = candidateForRequest(deps, request, reply, true);
  if (!candidate) return undefined;
  const workplaceId = routeId(request, reply, 'workplaceId');
  if (!workplaceId) return undefined;
  const parsed = z.object({ endDate: dateSchema }).strict().safeParse(request.body);
  if (!parsed.success) return invalidInput(reply, request);
  const current = deps.candidateStore.careerDiaryRepo.listWorkplaces(candidate.id)
    .find((item) => item.id === workplaceId);
  if (!current) return missingRecord(reply, request);
  if (parsed.data.endDate < current.startDate) return invalidInput(reply, request);
  const workplace = deps.candidateStore.careerDiaryRepo.updateWorkplace(
    candidate.id,
    workplaceId,
    parsed.data,
  );
  if (!workplace) return missingRecord(reply, request);
  return { data: workplace, meta: { requestId: request.id } };
};

export function registerCareerDiaryRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const readLimit = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
  const writeLimit = { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } };
  const base = '/api/v1/candidate/career-diary';
  app.get(base, readLimit, withDeps(deps, handleOverview));
  app.get(base + '/goals', readLimit, withDeps(deps, handleListGoals));
  app.post(base + '/goals', writeLimit, withDeps(deps, handleCreateGoal));
  app.get(base + '/goals/:goalId', readLimit, withDeps(deps, handleGetGoal));
  app.patch(base + '/goals/:goalId', writeLimit, withDeps(deps, handleUpdateGoal));
  app.delete(base + '/goals/:goalId', writeLimit, withDeps(deps, handleDeleteGoal));
  app.put(base + '/goals/:goalId/primary', writeLimit, withDeps(deps, handleSetPrimaryGoal));
  app.put(base + '/goals/:goalId/children', writeLimit, withDeps(deps, handleSplitGoal));
  app.get(base + '/goals/:goalId/measurements', readLimit, withDeps(deps, handleListMeasurements));
  app.post(base + '/goals/:goalId/measurements', writeLimit, withDeps(deps, handleRecordMeasurement));
  app.get(base + '/goals/:goalId/measurements/:measurementId', readLimit, withDeps(deps, handleGetMeasurement));
  app.get(base + '/reviews', readLimit, withDeps(deps, handleListReviews));
  app.put(base + '/reviews/:weekStart', writeLimit, withDeps(deps, handleUpsertReview));
  app.get(base + '/reviews/:weekStart', readLimit, withDeps(deps, handleGetReview));
  app.delete(base + '/reviews/:weekStart', writeLimit, withDeps(deps, handleDeleteReview));
  app.get(base + '/achievements', readLimit, withDeps(deps, handleListAchievements));
  app.get(base + '/achievements/:achievementId', readLimit, withDeps(deps, handleGetAchievement));
  app.post(base + '/achievements', writeLimit, withDeps(deps, handleCreateAchievement));
  app.patch(base + '/achievements/:achievementId', writeLimit, withDeps(deps, handleUpdateAchievement));
  app.get(base + '/workplaces', readLimit, withDeps(deps, handleListWorkplaces));
  app.get(base + '/workplaces/:workplaceId', readLimit, withDeps(deps, handleGetWorkplace));
  app.post(base + '/workplaces', writeLimit, withDeps(deps, handleCreateWorkplace));
  app.patch(base + '/workplaces/:workplaceId', writeLimit, withDeps(deps, handleUpdateWorkplace));
  app.put(base + '/workplaces/:workplaceId/primary', writeLimit, withDeps(deps, handleSetPrimaryWorkplace));
  app.put(base + '/workplaces/:workplaceId/archive', writeLimit, withDeps(deps, handleArchiveWorkplace));
}
