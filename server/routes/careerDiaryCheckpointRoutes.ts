import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CareerDiaryWorkplace } from '../../shared/careerDiary';
import { SqliteDiaryCheckpointRepository } from '../data/sqliteDiaryCheckpointRepository';
import { SqliteDiaryDetailsRepository } from '../data/sqliteDiaryDetailsRepository';
import { SqliteDiaryPeopleRepository } from '../data/sqliteDiaryPeopleRepository';
import { careerDiaryPlanningSchema } from '../domain/careerDiaryAdaptation';
import { buildDay30Check, buildResults90, type GoalTrack } from '../domain/careerDiaryCheckpoints';
import { buildPeopleMap, calendarDate } from '../domain/careerDiaryPeople';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { CareerDiaryPeopleRouteDeps } from './careerDiaryPeopleRoutes';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';

/**
 * B687: проверка на 30-й день и итоги 90 дней для экранов d01e и d04. Каждый маршрут
 * начинается с `requireCabinetB640`: без флага адреса отвечают как несуществующие.
 * Свод считается при чтении из целей, замеров, плана и карты людей; хранится только
 * отметка «письмо отправлено».
 */
interface Stores {
  readonly marks: () => SqliteDiaryCheckpointRepository;
  readonly people: () => SqliteDiaryPeopleRepository;
  readonly details: () => SqliteDiaryDetailsRepository;
}
type Bound = RouteDeps & Stores;
type Handler = (deps: Bound, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
interface Scope {
  readonly candidate: string;
  readonly workplace: CareerDiaryWorkplace;
}

const BASE = '/api/v1/candidate/career-diary/workplaces/:workplaceId';
const DAY30 = 'day30';
const sentSchema = z.object({ sentOn: calendarDate }).strict();
const today = (): string => new Date().toISOString().slice(0, 10);

function scope(deps: Bound, request: FastifyRequest, reply: FastifyReply): Scope | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  const id = z.string().uuid().safeParse((request.params as Record<string, unknown>).workplaceId);
  if (!id.success) {
    sendError(reply, request, 400, 'invalid_career_diary_input', 'Проверьте данные карьерного дневника.', false);
    return null;
  }
  const candidate = principal.candidate.id;
  const workplace = deps.candidateStore.careerDiaryRepo.getWorkplace(candidate, id.data);
  if (workplace) return { candidate, workplace };
  sendError(reply, request, 404, 'career_diary_record_not_found', 'Запись дневника не найдена.', false);
  return null;
}

function tracks(deps: Bound, candidate: string): GoalTrack[] {
  const repo = deps.candidateStore.careerDiaryRepo;
  const details = deps.details().goalDetails(candidate);
  return repo.listGoals(candidate).map((goal) => ({
    goal,
    measurements: [...repo.listMeasurements(candidate, goal.id)].sort((a, b) => a.measuredAt.localeCompare(b.measuredAt)),
    archived: Boolean(details.get(goal.id)?.archive),
  }));
}

function planTasks(workplace: CareerDiaryWorkplace) {
  const parsed = careerDiaryPlanningSchema.safeParse((workplace as { planning?: unknown }).planning);
  return parsed.success ? (parsed.data.adaptationPlan?.tasks ?? []) : [];
}

function day30(deps: Bound, { candidate, workplace }: Scope) {
  const tasks = planTasks(workplace);
  const people = buildPeopleMap(workplace.id, deps.people().list(candidate, workplace.id), tasks);
  return buildDay30Check({
    workplace,
    goals: tracks(deps, candidate),
    people,
    tasks,
    asOf: today(),
    sentOn: deps.marks().get(candidate, workplace.id, DAY30).sentOn,
  });
}

const getDay30: Handler = async (deps, request, reply) => {
  const at = scope(deps, request, reply);
  return at ? { data: day30(deps, at), meta: { requestId: request.id } } : undefined;
};

const putSent: Handler = async (deps, request, reply) => {
  const at = scope(deps, request, reply);
  if (!at) return undefined;
  const parsed = sentSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_career_diary_input', 'Проверьте данные карьерного дневника.', false);
  }
  deps.marks().save(at.candidate, at.workplace.id, DAY30, { sentOn: parsed.data.sentOn });
  return { data: day30(deps, at), meta: { requestId: request.id } };
};

const deleteSent: Handler = async (deps, request, reply) => {
  const at = scope(deps, request, reply);
  if (!at) return undefined;
  deps.marks().save(at.candidate, at.workplace.id, DAY30, { sentOn: null });
  return { data: day30(deps, at), meta: { requestId: request.id } };
};

const getResults: Handler = async (deps, request, reply) => {
  const at = scope(deps, request, reply);
  if (!at) return undefined;
  const results = buildResults90({ workplace: at.workplace, goals: tracks(deps, at.candidate), asOf: today() });
  return { data: results, meta: { requestId: request.id } };
};

export function registerCareerDiaryCheckpointRoutes(app: FastifyInstance, deps: CareerDiaryPeopleRouteDeps): void {
  // Хранилища открываются при первом запросе под флагом: без флага база не трогается.
  const options = { databasePath: deps.config.databasePath, encryptionKey: deps.config.dataEncryptionKey };
  let marks: SqliteDiaryCheckpointRepository | null = null;
  let people = deps.diaryPeopleRepository ?? null;
  let details = deps.diaryDetailsRepository ?? null;
  const bound: Bound = {
    ...deps,
    marks: () => (marks ??= new SqliteDiaryCheckpointRepository(options)),
    people: () => (people ??= new SqliteDiaryPeopleRepository(options)),
    details: () => (details ??= new SqliteDiaryDetailsRepository(options)),
  };
  app.addHook('onClose', async () => {
    marks?.close();
    if (!deps.diaryPeopleRepository) people?.close();
    if (!deps.diaryDetailsRepository) details?.close();
  });
  const read = { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } };
  const write = { config: { rateLimit: { max: 300, timeWindow: '1 hour' } } };
  app.get(`${BASE}/day-30`, read, withDeps(bound, getDay30));
  app.put(`${BASE}/day-30/sent`, write, withDeps(bound, putSent));
  app.delete(`${BASE}/day-30/sent`, write, withDeps(bound, deleteSent));
  app.get(`${BASE}/results-90`, read, withDeps(bound, getResults));
}
