import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  VACANCY_TRIAGE_MAX_IDS,
  VACANCY_TRIAGE_QUESTION_IDS,
  type VacancyTriage,
} from '../../shared/b640Vacancies';
import { getCurrencyRates } from '../currency/cbrRates';
import { applyVacancyDecisions } from '../vacancies/applyVacancyDecisions';
import { readMatchedSnapshot } from '../vacancies/matchedPoolContext';
import { mapYielding } from '../vacancies/mapYielding';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';
import { triageVacancies } from '../vacancies/vacancyTriage';
import { profileIsEmpty, readB640ListContext, sessionCandidate } from './b640VacancyContext';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import { withRequestScopedCandidateReads } from './requestScopedCandidateReads';
import { createVacancyFitContextReader, readVacancyFitTarget } from './vacancyFitContext';

const answersShape = Object.fromEntries(
  VACANCY_TRIAGE_QUESTION_IDS.map((id) => [id, z.boolean().optional()]),
) as Record<(typeof VACANCY_TRIAGE_QUESTION_IDS)[number], z.ZodOptional<z.ZodBoolean>>;

const bodySchema = z
  .object({
    clusterIds: z
      .array(z.string().min(1).max(200))
      .min(1)
      .max(VACANCY_TRIAGE_MAX_IDS)
      .refine((ids) => new Set(ids).size === ids.length),
    answers: z.object(answersShape).strict().default({}),
  })
  .strict();

const EMPTY: VacancyTriage = {
  rows: [],
  questions: [],
  questionTotal: 0,
  summary: { total: 0, keep: 0, hide: 0, needsData: 0 },
};

/** Строки в порядке запроса; чужие, скрытые и пропавшие из пула id отбрасываются. */
function requestedRows(
  snapshot: readonly MatchedVacancyItem[],
  deps: RouteDeps,
  candidateId: string,
  ids: readonly string[],
): MatchedVacancyItem[] {
  const visible = applyVacancyDecisions(snapshot, deps.candidateStore.listVacancyDecisions(candidateId));
  const byId = new Map(visible.map((item) => [item.cluster.id, item]));
  return ids.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
}

/** Проверки совпадения читаются из хранилища разбора без постановки в очередь: ничего не пишется. */
function withStoredFitViews(
  deps: RouteDeps,
  candidateId: string,
  rows: readonly MatchedVacancyItem[],
): Promise<MatchedVacancyItem[]> {
  const runtime = deps.vacancyMechanics;
  if (!runtime) return Promise.resolve([...rows]);
  const context = createVacancyFitContextReader(deps, candidateId);
  return mapYielding(rows, (item) => {
    const target = readVacancyFitTarget(deps, item.cluster.id);
    if (!target) return item;
    const fitView = runtime.view(context(target, []), { queueRequirements: false });
    return { ...item, explanation: { ...item.explanation, fitView } };
  });
}

async function buildTriage(
  deps: RouteDeps,
  candidateId: string,
  ids: readonly string[],
  answers: z.infer<typeof bodySchema>['answers'],
): Promise<VacancyTriage> {
  const context = readB640ListContext(deps, candidateId);
  if (profileIsEmpty(context)) return EMPTY;
  const snapshot = await readMatchedSnapshot(
    deps.multiSourceEngine,
    candidateId,
    context.confirmedSkills,
    context.targetRoles,
    context.targetLevel,
    context.geography,
  );
  const rows = await withStoredFitViews(deps, candidateId, requestedRows(snapshot, deps, candidateId, ids));
  const profile = deps.candidateStore.decisionProfileRepo.get(candidateId);
  const appliedIds = new Set([
    ...deps.candidateStore
      .listVacancyApplications(candidateId)
      .filter((application) => application.status === 'applied')
      .map((application) => application.clusterId),
    ...deps.candidateStore
      .listTrackerClusterStages(candidateId)
      .filter((card) => card.stage !== 'archived')
      .map((card) => card.clusterId),
  ]);
  return triageVacancies({
    rows,
    answers,
    appliedIds,
    ...(profile?.salaryFloor && profile.salaryFloor > 0
      ? { salaryFloor: { amount: profile.salaryFloor, currency: profile.salaryCurrency ?? 'RUB' } }
      : {}),
    ...(getCurrencyRates() ? { rates: getCurrencyRates() } : {}),
  });
}

const postTriage = async (
  routeDeps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> => {
  const principal = requireCabinetB640(request, reply, routeDeps);
  if (!principal) return reply;
  const candidate = sessionCandidate(request, reply, principal.candidate);
  if (!candidate) return reply;
  const body = bodySchema.safeParse(request.body);
  if (!body.success) {
    return sendError(reply, request, 400, 'invalid_body', 'Неверный список вакансий для разбора.', false);
  }
  const deps = withRequestScopedCandidateReads(routeDeps);
  const data = await buildTriage(deps, candidate.id, body.data.clusterIds, body.data.answers);
  return { data, meta: { requestId: request.id } };
};

/** B675: «Помочь выбрать» — разбор показанного списка по правилам; ничего не пишет, модель не зовёт. */
export function registerB640VacancyTriageRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/v1/candidate/b640/vacancy-triage', withDeps(deps, postTriage));
}
