import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CareerDiaryGoalCard } from '../../shared/careerDiaryCards';
import { SqliteGoalTaskSuggestionRepository } from '../data/sqliteGoalTaskSuggestionRepository';
import {
  goalContextHash,
  groundSuggestion,
  suggestionDueDate,
  type GoalSuggestionContext,
  type GoalTaskSuggestionInput,
} from '../domain/goalTaskSuggestion';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B743 · 2: одна подсказка следующей задачи по цели (d02a «Задачи»). Каждый маршрут начинается
 * с `requireCabinetB640`: без флага адреса отвечают как несуществующие. Вход модели собирается
 * здесь же из данных самого кандидата; провал модели — не ошибка, а «подсказки нет».
 */
export interface GoalPlanAccess {
  readonly goalCard: (candidate: string, goalId: string) => CareerDiaryGoalCard | null;
  /** Задачи основного места работы, привязанные к цели; `null` — основного места работы нет. */
  readonly goalTasks: (candidate: string, goalId: string) => GoalSuggestionContext['tasks'] | null;
}
export type TaskSuggestionRouteDeps = RouteDeps &
  GoalPlanAccess & { readonly suggestions: () => SqliteGoalTaskSuggestionRepository };
type Handler = (
  deps: TaskSuggestionRouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

const BASE = '/api/v1/candidate/career-diary/goal-cards/:goalId/task-suggestion';
/** Вызовов модели за сутки у одного кандидата: каждый — деньги. */
export const SUGGESTIONS_PER_DAY = 20;
const MEASUREMENTS = 5;
const ENTRIES = 10;
const TEXT_CHARS = 300;
const idSchema = z.string().uuid();

const today = (): string => new Date().toISOString().slice(0, 10);

function candidateId(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

const notFound = (reply: FastifyReply, request: FastifyRequest) =>
  sendError(
    reply,
    request,
    404,
    'career_diary_record_not_found',
    'Запись дневника не найдена.',
    false,
  );

const clip = (text: string): string => text.trim().slice(0, TEXT_CHARS);

/**
 * Вход модели из данных кандидата: карточка цели, последние замеры с комментариями, задачи цели
 * в плане, записи дневника по цели. Встреч нет: у встречи в плане нет темы, только человек.
 */
function buildContext(
  deps: TaskSuggestionRouteDeps,
  candidate: string,
  card: CareerDiaryGoalCard,
  tasks: NonNullable<ReturnType<GoalPlanAccess['goalTasks']>>,
): GoalSuggestionContext {
  const goalId = card.id;
  const { careerDiaryRepo, diaryEntryRepo } = deps.candidateStore;
  const indicators = card.indicators.length > 0 ? card.indicators : [card];
  return {
    goal: {
      title: card.title,
      startDate: card.startDate,
      dueDate: card.dueDate,
      risk: card.risk.status,
      indicators: indicators.map((item) => ({
        title: item.title,
        unit: item.unit,
        target: item.targetValue,
        latest: item.latestMeasurement?.value ?? null,
      })),
    },
    measurements: careerDiaryRepo
      .listMeasurements(candidate, goalId)
      .slice(0, MEASUREMENTS)
      .map((item) => ({
        date: item.measuredAt,
        value: item.value,
        comment: item.note ? clip(item.note) : null,
      })),
    tasks: tasks.map((task) => ({
      title: task.title,
      dueDate: task.dueDate,
      completed: task.completed,
    })),
    entries: diaryEntryRepo
      .list(candidate, ENTRIES, undefined, { goalId })
      .items.map((entry) => ({ date: entry.date, text: clip(entry.text) })),
  };
}

const answerOf = (
  record: { readonly id: string; readonly text: string | null; readonly dueDate: string | null },
  context: GoalSuggestionContext,
) =>
  record.text
    ? {
        id: record.id,
        text: record.text,
        dueDate: suggestionDueDate(record.dueDate, today(), context.goal.dueDate),
      }
    : null;

/** Спрашивает модель один раз на вход и запоминает ответ; сбой модели ничего не запоминает. */
async function generate(
  deps: TaskSuggestionRouteDeps,
  candidate: string,
  goalId: string,
  context: GoalSuggestionContext,
  hash: string,
) {
  const repository = deps.suggestions();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  if (!deps.goalTaskSuggester || !repository.takeAttempt(candidate, since, SUGGESTIONS_PER_DAY)) {
    return null;
  }
  const input: GoalTaskSuggestionInput = {
    today: today(),
    context,
    skipped: repository.skippedTexts(candidate, goalId),
  };
  const answer = await deps.goalTaskSuggester.suggest(input).catch(() => null);
  if (!answer) return null;
  return repository.create(candidate, goalId, hash, groundSuggestion(answer, input));
}

const getSuggestion: Handler = async (deps, request, reply) => {
  const candidate = candidateId(deps, request, reply);
  if (!candidate) return undefined;
  const parsed = idSchema.safeParse((request.params as { goalId?: unknown }).goalId);
  const card = parsed.success ? deps.goalCard(candidate, parsed.data) : null;
  if (!card) return notFound(reply, request);
  const tasks = deps.goalTasks(candidate, card.id);
  const empty = { data: null, meta: { requestId: request.id } };
  // Основного места работы нет: задаче негде жить — подсказки нет, модель не зовётся.
  if (!tasks) return empty;
  const context = buildContext(deps, candidate, card, tasks);
  const hash = goalContextHash(context);
  const known = deps.suggestions().find(candidate, card.id, hash);
  const record = known ?? (await generate(deps, candidate, card.id, context, hash));
  const open = record?.status === 'open' ? record : null;
  return { data: open ? answerOf(open, context) : null, meta: { requestId: request.id } };
};

function resolver(status: 'added' | 'skipped'): Handler {
  return async (deps, request, reply) => {
    const candidate = candidateId(deps, request, reply);
    if (!candidate) return undefined;
    const params = request.params as { goalId?: unknown; id?: unknown };
    const goalId = idSchema.safeParse(params.goalId);
    const id = idSchema.safeParse(params.id);
    if (!goalId.success || !id.success) return notFound(reply, request);
    if (!deps.suggestions().resolve(candidate, goalId.data, id.data, status)) {
      return notFound(reply, request);
    }
    return reply.code(204).send();
  };
}

export function registerCareerDiaryTaskSuggestionRoutes(
  app: FastifyInstance,
  deps: RouteDeps &
    GoalPlanAccess & { readonly taskSuggestionRepository?: SqliteGoalTaskSuggestionRepository },
): void {
  // Хранилище открывается при первом запросе под флагом: без флага база не трогается.
  let repository = deps.taskSuggestionRepository ?? null;
  const suggestions = () => {
    repository ??= new SqliteGoalTaskSuggestionRepository({
      databasePath: deps.config.databasePath,
      encryptionKey: deps.config.dataEncryptionKey,
    });
    return repository;
  };
  if (!deps.taskSuggestionRepository) app.addHook('onClose', async () => repository?.close());
  const bound: TaskSuggestionRouteDeps = { ...deps, suggestions };
  const read = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
  const write = { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } };
  app.get(BASE, read, withDeps(bound, getSuggestion));
  app.post(`${BASE}/:id/skip`, write, withDeps(bound, resolver('skipped')));
  app.post(`${BASE}/:id/accept`, write, withDeps(bound, resolver('added')));
}
