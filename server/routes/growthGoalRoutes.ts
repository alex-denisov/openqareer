import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CareerDiaryWorkplace } from '../../shared/careerDiary';
import { SqliteGrowthGoalRepository } from '../candidate/sqliteGrowthGoalRepository';
import { getCurrencyRates } from '../currency/cbrRates';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { careerDiaryPlanningSchema } from '../domain/careerDiaryAdaptation';
import { GROWTH_GOALS, growthArguments, growthSteps, type GrowthPlan } from '../domain/growthGoal';
import { professionWage } from '../domain/professionPath';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { readRoleSnapshot } from './roleSkillAssessmentRoutes';

/**
 * B670: «Карьера» при «Работаю» — цель роста в нынешней компании и шаги к ней
 * из плана 30-60-90 и дневника. Без флага B640 адреса отвечают как
 * несуществующие. Расчёт идёт на запросе кандидата, фоновых задач нет.
 */
type BoundDeps = RouteDeps & { readonly goals: SqliteGrowthGoalRepository };
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const goalSchema = z.object({ goal: z.enum(GROWTH_GOALS) }).strict();
const ARGUMENT_PAGE = 50;

function candidateOf(deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

function workplaceOf(deps: BoundDeps, candidateId: string): CareerDiaryWorkplace | null {
  const list = deps.candidateStore.careerDiaryRepo.listWorkplaces(candidateId);
  const active = list.filter((item) => item.status === 'active');
  return active.find((item) => item.isPrimary) ?? active[0] ?? null;
}

function planOf(workplace: CareerDiaryWorkplace): GrowthPlan | null {
  const parsed = careerDiaryPlanningSchema.safeParse(
    (workplace as { planning?: unknown }).planning,
  );
  return parsed.success ? parsed.data.adaptationPlan : null;
}

async function wageOf(deps: BoundDeps, candidateId: string, title: string) {
  const snapshot = await readRoleSnapshot(deps, candidateId, title);
  if (snapshot.state !== 'matched') return null;
  return professionWage(
    snapshot.vacancies.map(({ cluster, explanation }) => ({
      roleMatch: explanation.roleMatch,
      status: cluster.status,
      observedAt: cluster.sources.map((source) => source.observedAt),
      salary: cluster.salary,
    })),
    new Date(),
    getCurrencyRates(),
  );
}

async function readGrowth(deps: BoundDeps, candidateId: string) {
  const workplace = workplaceOf(deps, candidateId);
  if (!workplace) return { state: 'no_workplace' } as const;
  const place = { company: workplace.company, title: workplace.title };
  const goal = deps.goals.current(candidateId, workplace.id);
  if (!goal) return { state: 'no_goal', ...place } as const;
  const today = new Date().toISOString().slice(0, 10);
  const diary = deps.candidateStore.careerDiaryRepo.listGoals(candidateId);
  const entries = deps.candidateStore.diaryEntryRepo.list(candidateId, ARGUMENT_PAGE, undefined, {
    kind: 'result',
  });
  return {
    state: 'ready',
    ...place,
    goal,
    steps: growthSteps(planOf(workplace), diary, today),
    arguments: growthArguments(entries.items),
    wage: await wageOf(deps, candidateId, workplace.title),
  } as const;
}

const getGrowth: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  return { data: await readGrowth(deps, candidateId), meta: { requestId: request.id } };
};

const putGoal: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = goalSchema.safeParse(request.body);
  if (!parsed.success)
    return sendError(reply, request, 400, 'invalid_goal', 'Выберите одну из целей.', false);
  const workplace = workplaceOf(deps, candidateId);
  if (!workplace)
    return sendError(reply, request, 409, 'no_workplace', 'Сначала добавьте место работы.', false);
  const goal = deps.goals.choose(
    candidateId,
    workplace.id,
    parsed.data.goal,
    new Date().toISOString(),
  );
  return { data: { goal }, meta: { requestId: request.id } };
};

export function registerGrowthGoalRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const database = new DatabaseSync(deps.config.databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  applySqliteBusyTimeout(database);
  app.addHook('onClose', async () => database.close());
  const bound: BoundDeps = { ...deps, goals: new SqliteGrowthGoalRepository(database) };
  const limit = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  app.get('/api/v1/candidate/career/growth', limit, withDeps(bound, getGrowth));
  app.put('/api/v1/candidate/career/growth/goal', limit, withDeps(bound, putGoal));
}
