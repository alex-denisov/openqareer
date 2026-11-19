import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CareerDiaryWorkplace } from '../../shared/careerDiary';
import { PEOPLE_MAX, type CareerDiaryPerson } from '../../shared/careerDiaryPeople';
import { SqliteDiaryDetailsRepository } from '../data/sqliteDiaryDetailsRepository';
import { SqliteDiaryPeopleRepository } from '../data/sqliteDiaryPeopleRepository';
import { careerDiaryPlanningSchema, type CareerDiaryAdaptationPlanInput } from '../domain/careerDiaryAdaptation';
import type { PlanTask } from '../domain/careerDiaryAdaptationView';
import {
  buildPeopleMap,
  meetingSchema,
  meetingTaskId,
  personInputSchema,
  personIsNamed,
  personPatchSchema,
  withMeetingTask,
  withoutTask,
} from '../domain/careerDiaryPeople';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B685: карта людей на новом месте (d01d). Каждый маршрут начинается с
 * `requireCabinetB640`: без флага адреса отвечают как несуществующие и база не трогается.
 * Встреча с человеком — задача прежнего плана адаптации в шаге «Карта людей».
 */
export type CareerDiaryPeopleRouteDeps = RouteDeps & {
  readonly diaryPeopleRepository?: SqliteDiaryPeopleRepository;
  readonly diaryDetailsRepository?: SqliteDiaryDetailsRepository;
};
interface Stores {
  readonly people: () => SqliteDiaryPeopleRepository;
  readonly details: () => SqliteDiaryDetailsRepository;
}
type Bound = RouteDeps & Stores;
type Handler = (deps: Bound, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
interface Scope {
  readonly candidate: string;
  readonly workplace: CareerDiaryWorkplace;
}

const BASE = '/api/v1/candidate/career-diary/workplaces/:workplaceId/people';
const idSchema = z.string().uuid();

const invalid = (reply: FastifyReply, request: FastifyRequest) =>
  sendError(reply, request, 400, 'invalid_career_diary_input', 'Проверьте данные карьерного дневника.', false);
const missing = (reply: FastifyReply, request: FastifyRequest) =>
  sendError(reply, request, 404, 'career_diary_record_not_found', 'Запись дневника не найдена.', false);
const conflict = (reply: FastifyReply, request: FastifyRequest, code: string, message: string) =>
  sendError(reply, request, 409, code, message, false);

function param(request: FastifyRequest, name: string): string | null {
  const parsed = idSchema.safeParse((request.params as Record<string, unknown>)[name]);
  return parsed.success ? parsed.data : null;
}

/** Кандидат под флагом и его место работы; иначе ответ уже отправлен. */
function scope(deps: Bound, request: FastifyRequest, reply: FastifyReply): Scope | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  const workplaceId = param(request, 'workplaceId');
  if (!workplaceId) return (invalid(reply, request), null);
  const candidate = principal.candidate.id;
  const workplace = deps.candidateStore.careerDiaryRepo.getWorkplace(candidate, workplaceId);
  return workplace ? { candidate, workplace } : (missing(reply, request), null);
}

function planOf(workplace: CareerDiaryWorkplace): CareerDiaryAdaptationPlanInput | null {
  const parsed = careerDiaryPlanningSchema.safeParse((workplace as { planning?: unknown }).planning);
  return parsed.success ? parsed.data.adaptationPlan : null;
}

function mapOf(deps: Bound, { candidate, workplace }: Scope) {
  const fresh = deps.candidateStore.careerDiaryRepo.getWorkplace(candidate, workplace.id) ?? workplace;
  return buildPeopleMap(workplace.id, deps.people().list(candidate, workplace.id), planOf(fresh)?.tasks ?? []);
}

const ok = (deps: Bound, request: FastifyRequest, at: Scope) => ({
  data: mapOf(deps, at),
  meta: { requestId: request.id },
});

/** Записывает задачи плана; плана нет — заводит пустой активный план места работы. */
function savePlan(deps: Bound, at: Scope, change: (tasks: readonly PlanTask[]) => PlanTask[]): void {
  const plan = planOf(at.workplace) ?? {
    id: randomUUID(),
    workplaceId: at.workplace.id,
    startDate: at.workplace.startDate,
    createdAt: new Date().toISOString(),
    status: 'active' as const,
    closedAt: null,
    tasks: [],
  };
  const adaptationPlan = { ...plan, tasks: change(plan.tasks) };
  // Как в прежнем PATCH места работы: план лежит в поле `planning` записи.
  const patch = { startDate: at.workplace.startDate, planning: { adaptationPlan } };
  deps.candidateStore.careerDiaryRepo.updateWorkplace(at.candidate, at.workplace.id, patch);
}

/** Шаг «Карта людей» у задачи встречи; `null` — детали задачи убираются. */
function setTaskStep(deps: Bound, at: Scope, taskId: string, keep: boolean): void {
  const current = deps.details().adaptationDetails(at.candidate, at.workplace.id);
  const { [taskId]: _dropped, ...rest } = current.tasks;
  const tasks = keep ? { ...rest, [taskId]: { ...current.tasks[taskId], step: 'people_map' as const } } : rest;
  deps.details().saveAdaptationDetails(at.candidate, at.workplace.id, { ...current, tasks });
}

const getPeople: Handler = async (deps, request, reply) => {
  const at = scope(deps, request, reply);
  return at ? ok(deps, request, at) : undefined;
};

const postPerson: Handler = async (deps, request, reply) => {
  const at = scope(deps, request, reply);
  if (!at) return undefined;
  const parsed = personInputSchema.safeParse(request.body);
  if (!parsed.success) return invalid(reply, request);
  const key = idSchema.safeParse(request.headers['idempotency-key']);
  const id = key.success ? key.data : randomUUID();
  if (deps.people().get(at.candidate, at.workplace.id, id)) return ok(deps, request, at);
  if (deps.people().count(at.candidate, at.workplace.id) >= PEOPLE_MAX) {
    return conflict(reply, request, 'career_diary_people_full', 'На карте уже 100 строк.');
  }
  const person: CareerDiaryPerson = { ...parsed.data, id, meeting: null, createdAt: new Date().toISOString() };
  deps.people().save(at.candidate, at.workplace.id, person);
  return reply.code(201).send(ok(deps, request, at));
};

function personAt(deps: Bound, request: FastifyRequest, reply: FastifyReply) {
  const at = scope(deps, request, reply);
  if (!at) return null;
  const personId = param(request, 'personId');
  if (!personId) return (invalid(reply, request), null);
  const person = deps.people().get(at.candidate, at.workplace.id, personId);
  return person ? { at, person } : (missing(reply, request), null);
}

/** Встреча отмечена: незакрытая задача встречи закрывается этим днём. */
function closeMeeting(deps: Bound, at: Scope, person: CareerDiaryPerson, metOn: string): void {
  const id = meetingTaskId(person.id);
  const task = planOf(at.workplace)?.tasks.find((item) => item.id === id);
  if (!task || task.completed) return;
  savePlan(deps, at, (tasks) =>
    tasks.map((item) => (item.id === id ? { ...item, completed: true, dueDate: metOn } : item)),
  );
}

const patchPerson: Handler = async (deps, request, reply) => {
  const found = personAt(deps, request, reply);
  if (!found) return undefined;
  const parsed = personPatchSchema.safeParse(request.body);
  if (!parsed.success) return invalid(reply, request);
  const person = { ...found.person, ...parsed.data };
  if (!personIsNamed(person)) return invalid(reply, request);
  deps.people().save(found.at.candidate, found.at.workplace.id, person);
  if (parsed.data.lastMetOn) closeMeeting(deps, found.at, person, parsed.data.lastMetOn);
  return ok(deps, request, found.at);
};

/** Убирает из плана незакрытую задачу встречи; закрытая остаётся в истории плана. */
function dropOpenMeeting(deps: Bound, at: Scope, personId: string): void {
  const id = meetingTaskId(personId);
  const task = planOf(at.workplace)?.tasks.find((item) => item.id === id);
  if (!task || task.completed) return;
  savePlan(deps, at, (tasks) => withoutTask(tasks, id));
  setTaskStep(deps, at, id, false);
}

const deletePerson: Handler = async (deps, request, reply) => {
  const found = personAt(deps, request, reply);
  if (!found) return undefined;
  dropOpenMeeting(deps, found.at, found.person.id);
  deps.people().delete(found.at.candidate, found.at.workplace.id, found.person.id);
  return ok(deps, request, found.at);
};

function meetingBlocked(at: Scope, person: CareerDiaryPerson): string | null {
  if (at.workplace.status === 'archived') return 'Архивное место работы доступно только для чтения.';
  const plan = planOf(at.workplace);
  if (plan?.status === 'closed') return 'План адаптации закрыт.';
  const exists = plan?.tasks.some((task) => task.id === meetingTaskId(person.id));
  return !exists && (plan?.tasks.length ?? 0) >= 100 ? 'В плане уже 100 задач.' : null;
}

const putMeeting: Handler = async (deps, request, reply) => {
  const parsedBody = meetingSchema.safeParse(request.body);
  const found = personAt(deps, request, reply);
  if (!found) return undefined;
  if (!parsedBody.success) return invalid(reply, request);
  const { at, person } = found;
  const blocked = meetingBlocked(at, person);
  if (blocked) return conflict(reply, request, 'career_diary_plan_locked', blocked);
  const { date } = parsedBody.data;
  savePlan(deps, at, (tasks) => withMeetingTask(tasks, person, date, at.workplace.startDate));
  setTaskStep(deps, at, meetingTaskId(person.id), true);
  const meeting = { taskId: meetingTaskId(person.id), date };
  deps.people().save(at.candidate, at.workplace.id, { ...person, meeting });
  return ok(deps, request, at);
};

const deleteMeeting: Handler = async (deps, request, reply) => {
  const found = personAt(deps, request, reply);
  if (!found) return undefined;
  dropOpenMeeting(deps, found.at, found.person.id);
  return ok(deps, request, found.at);
};

export function registerCareerDiaryPeopleRoutes(app: FastifyInstance, deps: CareerDiaryPeopleRouteDeps): void {
  // Хранилища открываются при первом запросе под флагом: без флага база не трогается.
  const options = { databasePath: deps.config.databasePath, encryptionKey: deps.config.dataEncryptionKey };
  let people = deps.diaryPeopleRepository ?? null;
  let details = deps.diaryDetailsRepository ?? null;
  const stores: Stores = {
    people: () => (people ??= new SqliteDiaryPeopleRepository(options)),
    details: () => (details ??= new SqliteDiaryDetailsRepository(options)),
  };
  app.addHook('onClose', async () => {
    if (!deps.diaryPeopleRepository) people?.close();
    if (!deps.diaryDetailsRepository) details?.close();
  });
  const bound: Bound = { ...deps, ...stores };
  const read = { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } };
  const write = { config: { rateLimit: { max: 300, timeWindow: '1 hour' } } };
  app.get(BASE, read, withDeps(bound, getPeople));
  app.post(BASE, write, withDeps(bound, postPerson));
  app.patch(`${BASE}/:personId`, write, withDeps(bound, patchPerson));
  app.delete(`${BASE}/:personId`, write, withDeps(bound, deletePerson));
  app.put(`${BASE}/:personId/meeting`, write, withDeps(bound, putMeeting));
  app.delete(`${BASE}/:personId/meeting`, write, withDeps(bound, deleteMeeting));
}
