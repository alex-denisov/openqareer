import { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MIN_ROLE_SAMPLE, titleKey } from '../../shared/poolRoleHypotheses';
import type { SqliteCandidateStatusRepository } from '../candidate/sqliteCandidateStatusRepository';
import { SqliteProfessionPathRepository } from '../candidate/sqliteProfessionPathRepository';
import { getCurrencyRates } from '../currency/cbrRates';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { professionForms } from '../domain/professionForms';
import {
  LOWER_INCOME_ANSWERS,
  professionResponses,
  professionWage,
} from '../domain/professionPath';
import { countFreshActiveRoleVacancies } from '../domain/roleSkillAssessment';
import { buildRoleSkillDemand } from '../domain/roleSkillDemand';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { toAssessmentVacancies } from './roleAssessmentVacancies';
import { readRoleSnapshot } from './roleSkillAssessmentRoutes';
import { createRoleRequirementReader } from './roleSkillRequirementSource';
import { signalApplicationOf } from './statusSignalRoutes';

/**
 * B669: «Карьера» при «Меняю профессию». Каждый маршрут начинается с
 * `requireCabinetB640`: без флага адреса отвечают как несуществующие.
 * Расчёт идёт на запросе кандидата, фоновых задач нет.
 */
export type ProfessionPathRouteDeps = RouteDeps & {
  readonly statusRepository: Pick<SqliteCandidateStatusRepository, 'current'>;
};

type BoundDeps = ProfessionPathRouteDeps & { readonly answers: SqliteProfessionPathRepository };
type Handler = (deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const answerSchema = z.object({ answer: z.enum(LOWER_INCOME_ANSWERS) }).strict();

function candidateOf(deps: BoundDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (!principal.candidate) {
    sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
    return null;
  }
  return principal.candidate.id;
}

function targetOf(deps: BoundDeps, candidateId: string): string | null {
  const current = deps.statusRepository.current(candidateId);
  if (current?.status !== 'changing_profession') return null;
  return current.targetProfession?.trim() || null;
}

function responsesOf(deps: BoundDeps, candidateId: string, target: string) {
  const views = deps.candidateStore.listApplications(candidateId).map((view) => ({
    vacancyTitle: view.vacancy?.title,
    stage: view.stage,
    applied: signalApplicationOf(view, new Set()).appliedAt !== null,
  }));
  return professionResponses(views, target);
}

async function readPath(deps: BoundDeps, candidateId: string, target: string) {
  const snapshot = await readRoleSnapshot(deps, candidateId, target);
  if (snapshot.state !== 'matched') return { state: 'source_unavailable', target } as const;
  const roleId = titleKey(target);
  const now = new Date();
  const vacancies = toAssessmentVacancies(
    snapshot.vacancies,
    roleId,
    now,
    createRoleRequirementReader(deps),
  );
  const skills = deps.candidateStore.getSnapshot(candidateId)?.resume?.draft.skills ?? [];
  const demand = buildRoleSkillDemand(
    target,
    roleId,
    vacancies,
    skills.map((skill) => skill.name),
    MIN_ROLE_SAMPLE,
  );
  if (!demand) {
    const sampleSize = countFreshActiveRoleVacancies(vacancies, roleId);
    return { state: 'too_few', target, sampleSize, threshold: MIN_ROLE_SAMPLE } as const;
  }
  const wage = professionWage(
    snapshot.vacancies.map(({ cluster, explanation }) => ({
      roleMatch: explanation.roleMatch,
      status: cluster.status,
      observedAt: cluster.sources.map((source) => source.observedAt),
      salary: cluster.salary,
    })),
    now,
    getCurrencyRates(),
  );
  return {
    state: 'ready',
    target,
    sampleSize: demand.sampleSize,
    observedAt: demand.observedAt,
    requirements: demand.skills,
    wage,
    responses: responsesOf(deps, candidateId, target),
    lowerIncome: deps.answers.lowerIncome(candidateId, roleId),
  } as const;
}

const getPath: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const target = targetOf(deps, candidateId);
  // B669: падежные формы профессии для текстов пути; без форм — общие тексты.
  const data = target
    ? { ...(await readPath(deps, candidateId, target)), forms: professionForms(target) }
    : { state: 'no_target' };
  return { data, meta: { requestId: request.id } };
};

const putLowerIncome: Handler = async (deps, request, reply) => {
  const candidateId = candidateOf(deps, request, reply);
  if (!candidateId) return reply;
  const parsed = answerSchema.safeParse(request.body);
  if (!parsed.success)
    return sendError(reply, request, 400, 'invalid_answer', 'Выберите один из ответов.', false);
  const target = targetOf(deps, candidateId);
  if (!target)
    return sendError(
      reply,
      request,
      409,
      'no_target_profession',
      'Сначала выберите профессию.',
      false,
    );
  deps.answers.putLowerIncome(
    candidateId,
    titleKey(target),
    parsed.data.answer,
    new Date().toISOString(),
  );
  return { data: { lowerIncome: parsed.data.answer }, meta: { requestId: request.id } };
};

export function registerProfessionPathRoutes(
  app: FastifyInstance,
  deps: ProfessionPathRouteDeps,
): void {
  const database = new DatabaseSync(deps.config.databasePath);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  applySqliteBusyTimeout(database);
  app.addHook('onClose', async () => database.close());
  const bound: BoundDeps = { ...deps, answers: new SqliteProfessionPathRepository(database) };
  const read = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
  app.get('/api/v1/candidate/career/profession-path', read, withDeps(bound, getPath));
  app.put(
    '/api/v1/candidate/career/profession-path/lower-income',
    read,
    withDeps(bound, putLowerIncome),
  );
}
