import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { evaluateCareerGoalRisk, type CareerDiaryGoalSummary } from '../../shared/careerDiary';
import {
  DIARY_ENTRIES_PAGE,
  DIARY_ENTRY_KINDS,
  DIARY_ENTRY_TEXT_MAX,
  DIARY_WEEK_ITEMS_MAX,
  DIARY_WEEK_TEXT_MAX,
  diaryWeekStart,
  isDiaryDate,
  shiftDiaryDate,
  type CareerDiaryEntry,
  type CareerDiaryEntryFeed,
  type CareerDiaryEntryInput,
  type CareerDiaryWeekDraft,
} from '../../shared/careerDiaryEntries';
import {
  DiaryEntryKeyReusedError,
  InvalidDiaryEntryCursorError,
} from '../data/sqliteDiaryEntryRepository';
import { defaultAchieved, defaultBlockers, suggestWeekPlan } from '../domain/careerDiaryWeekDraft';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B683: записи дневника и итог недели для кабинета B640. Каждый маршрут начинается с
 * `requireCabinetB640`: без флага адреса отвечают как несуществующие. Прежние маршруты
 * дневника (`careerDiaryRoutes.ts`) и их ответы не меняются.
 */
type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const BASE = '/api/v1/candidate/career-diary';
/** Обещание переносится из последнего итога не старше стольких недель. */
const CARRY_WEEKS = 8;
/** Предел записей у одного кандидата: выгрузка и лента остаются обозримыми. */
const ENTRIES_LIMIT = 5000;
const idSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/u);
const dateSchema = z.string().refine(isDiaryDate);
const weekStartSchema = dateSchema.refine((date) => diaryWeekStart(date) === date);
const textSchema = z.string().trim().min(1).max(DIARY_ENTRY_TEXT_MAX);
const entrySchema = z
  .object({
    date: dateSchema,
    kind: z.enum(DIARY_ENTRY_KINDS),
    text: textSchema,
    goalId: idSchema.nullish(),
  })
  .strict();
const entryPatchSchema = entrySchema
  .partial()
  .refine((patch) => Object.keys(patch).length > 0);
const feedQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(DIARY_ENTRIES_PAGE),
  cursor: z.string().min(1).max(512).optional(),
  kind: z.enum(DIARY_ENTRY_KINDS).optional(),
  goalId: idSchema.optional(),
});
const shortText = z.string().trim().min(1).max(500);
const summarySchema = z
  .object({
    achievedEntryIds: z.array(idSchema).max(200),
    achievedNotes: z.array(shortText).max(DIARY_WEEK_ITEMS_MAX),
    blockers: z.string().trim().max(DIARY_WEEK_TEXT_MAX),
    plan: z
      .array(
        z
          .object({ text: shortText, goalId: idSchema.nullable(), done: z.boolean().default(false) })
          .strict(),
      )
      .max(DIARY_WEEK_ITEMS_MAX),
  })
  .strict();
const keySchema = z.string().uuid();

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
  return sendError(reply, request, 404, 'career_diary_record_not_found', 'Запись дневника не найдена.', false);
}

function candidateId(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

function param<T>(
  schema: z.ZodType<T>,
  request: FastifyRequest,
  reply: FastifyReply,
  name: string,
): T | null {
  const parsed = schema.safeParse((request.params as Record<string, unknown>)[name]);
  if (parsed.success) return parsed.data;
  invalid(reply, request);
  return null;
}

/** Запись датируется не позже завтрашнего дня: часовой пояс кандидата может опережать сервер. */
function dateAllowed(date: string | undefined): boolean {
  if (date === undefined) return true;
  const tomorrow = shiftDiaryDate(new Date().toISOString().slice(0, 10), 1);
  return tomorrow !== null && date <= tomorrow && date >= '2000-01-01';
}

function goalKnown(deps: RouteDeps, candidate: string, goalId: string | null | undefined): boolean {
  if (goalId === null || goalId === undefined) return true;
  return deps.candidateStore.careerDiaryRepo.getGoal(candidate, goalId) !== null;
}

const listEntries: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const query = feedQuerySchema.safeParse(request.query);
  if (!query.success) return invalid(reply, request);
  const { limit, cursor, kind, goalId } = query.data;
  const entries = deps.candidateStore.diaryEntryRepo;
  try {
    const page = entries.list(candidate, limit, cursor, { kind, goalId });
    const weeks = [...new Set(page.items.map((item) => item.weekStart))];
    const data: CareerDiaryEntryFeed = { ...page, summaries: entries.listSummaries(candidate, weeks) };
    return { data, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof InvalidDiaryEntryCursorError) return invalid(reply, request);
    throw error;
  }
};

/** Сохраняет запись; `null` — ответ с отказом уже отправлен. */
function storeEntry(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidate: string,
  input: CareerDiaryEntryInput,
  key: string,
): CareerDiaryEntry | null {
  const repo = deps.candidateStore.diaryEntryRepo;
  try {
    // Повтор с тем же ключом пределом не считается: запись уже есть.
    const entry = repo.create(candidate, input, key, undefined, ENTRIES_LIMIT);
    if (entry) return entry;
    sendError(reply, request, 409, 'career_diary_entry_limit', 'В дневнике слишком много записей.', false);
  } catch (error) {
    if (!(error instanceof DiaryEntryKeyReusedError)) throw error;
    sendError(
      reply,
      request,
      409,
      'idempotency_key_reused',
      'Ключ идемпотентности уже использован с другими данными.',
      false,
    );
  }
  return null;
}

const createEntry: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const key = keySchema.safeParse(request.headers['idempotency-key']);
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
  const parsed = entrySchema.safeParse(request.body);
  if (!parsed.success) return invalid(reply, request);
  if (!dateAllowed(parsed.data.date)) return invalid(reply, request, { date: 'Проверьте дату.' });
  if (!goalKnown(deps, candidate, parsed.data.goalId)) {
    return invalid(reply, request, { goalId: 'Такой цели нет.' });
  }
  const entry = storeEntry(deps, request, reply, candidate, parsed.data, key.data);
  if (!entry) return undefined;
  return reply
    .header('Location', `${BASE}/entries/${entry.id}`)
    .code(201)
    .send({ data: entry, meta: { requestId: request.id } });
};

const updateEntry: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const id = param(idSchema, request, reply, 'entryId');
  if (!id) return undefined;
  const parsed = entryPatchSchema.safeParse(request.body);
  if (!parsed.success) return invalid(reply, request);
  if (!dateAllowed(parsed.data.date)) return invalid(reply, request, { date: 'Проверьте дату.' });
  if (!goalKnown(deps, candidate, parsed.data.goalId)) {
    return invalid(reply, request, { goalId: 'Такой цели нет.' });
  }
  const entry = deps.candidateStore.diaryEntryRepo.update(candidate, id, parsed.data);
  return entry ? { data: entry, meta: { requestId: request.id } } : missing(reply, request);
};

const deleteEntry: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const id = param(idSchema, request, reply, 'entryId');
  if (!id) return undefined;
  const deleted = deps.candidateStore.diaryEntryRepo.delete(candidate, id);
  return deleted ? reply.code(204).send() : missing(reply, request);
};

function goalSummaries(deps: RouteDeps, candidate: string, asOf: string): CareerDiaryGoalSummary[] {
  const repo = deps.candidateStore.careerDiaryRepo;
  return repo.listGoals(candidate).map((goal) => {
    const latestMeasurement = repo.listMeasurements(candidate, goal.id)[0] ?? null;
    return { ...goal, latestMeasurement, risk: evaluateCareerGoalRisk(goal, latestMeasurement, asOf) };
  });
}

const getWeek: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const weekStart = param(weekStartSchema, request, reply, 'weekStart');
  if (!weekStart) return undefined;
  const repo = deps.candidateStore.diaryEntryRepo;
  const entries = repo.listWeek(candidate, weekStart);
  const since = shiftDiaryDate(weekStart, -7 * CARRY_WEEKS) ?? weekStart;
  const ids = new Set(entries.map((entry) => entry.id));
  const saved = repo.getSummary(candidate, weekStart);
  const data: CareerDiaryWeekDraft = {
    weekStart,
    entries,
    achievedEntryIds: defaultAchieved(entries),
    blockers: defaultBlockers(entries),
    plan: suggestWeekPlan({
      goals: goalSummaries(deps, candidate, new Date().toISOString().slice(0, 10)),
      previous: repo.latestSummaryBefore(candidate, weekStart, since),
      weekStart,
    }),
    // Запись могли удалить или перенести на другую неделю уже после сохранения итога.
    saved: saved && {
      ...saved,
      achievedEntryIds: saved.achievedEntryIds.filter((id) => ids.has(id)),
    },
  };
  return { data, meta: { requestId: request.id } };
};

const saveWeek: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const weekStart = param(weekStartSchema, request, reply, 'weekStart');
  if (!weekStart) return undefined;
  const parsed = summarySchema.safeParse(request.body);
  if (!parsed.success) return invalid(reply, request);
  const repo = deps.candidateStore.diaryEntryRepo;
  const ofWeek = new Set(repo.listWeek(candidate, weekStart).map((entry) => entry.id));
  if (parsed.data.achievedEntryIds.some((id) => !ofWeek.has(id))) {
    return invalid(reply, request, { achievedEntryIds: 'Запись не из этой недели.' });
  }
  if (parsed.data.plan.some((item) => !goalKnown(deps, candidate, item.goalId))) {
    return invalid(reply, request, { plan: 'Такой цели нет.' });
  }
  const summary = repo.saveSummary(candidate, weekStart, parsed.data);
  return { data: summary, meta: { requestId: request.id } };
};

export function registerCareerDiaryEntryRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const read = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
  const write = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
  app.get(`${BASE}/entries`, read, withDeps(deps, listEntries));
  app.post(`${BASE}/entries`, write, withDeps(deps, createEntry));
  app.patch(`${BASE}/entries/:entryId`, write, withDeps(deps, updateEntry));
  app.delete(`${BASE}/entries/:entryId`, write, withDeps(deps, deleteEntry));
  app.get(`${BASE}/weeks/:weekStart`, read, withDeps(deps, getWeek));
  app.put(`${BASE}/weeks/:weekStart`, write, withDeps(deps, saveWeek));
}
