import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RoleSkillAssessmentRun } from '../domain/roleSkillAssessment';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import {
  checkReplay,
  conflict,
  requestBase,
  requestDigest,
  saveRun,
  singleFlight,
  updateSkillResult,
} from './roleSkillAssessmentRouteSupport';

/**
 * B734: итог кейса меняет навык только по решению кандидата — «Верно» записывает
 * оценку, «Пропустить» оставляет навык как был. Адрес за флагом B640.
 */
const paramsSchema = z.object({
  runId: z.string().uuid(),
  caseId: z.string().min(1).max(240),
});
const decisionSchema = requestBase.extend({ accepted: z.boolean() }).strict();

export function registerRoleSkillCaseDecisionRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/role-skill-assessments/:runId/cases/:caseId/decision',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    withDeps(deps, handleDecision),
  );
}

/** Итог, по которому кандидат ещё может решить: ждёт ответа или пропущен. */
function isOpen(record: RoleSkillAssessmentRun['cases'][number]): boolean {
  return (
    Boolean(record.evaluation) && (record.decision === 'pending' || record.decision === 'declined')
  );
}

function decidedRun(
  run: RoleSkillAssessmentRun,
  caseIndex: number,
  accepted: boolean,
): RoleSkillAssessmentRun {
  const record = run.cases[caseIndex]!;
  const evaluation = record.evaluation!;
  const next = accepted
    ? updateSkillResult(
        run,
        record.assessmentCase.skillId,
        evaluation.grade,
        evaluation.criteria
          .map((criterion) => criterion.explanation)
          .join(' ')
          .slice(0, 1_000),
      )
    : run;
  return {
    ...next,
    revision: run.revision + 1,
    updatedAt: new Date().toISOString(),
    cases: run.cases.map((item, index) =>
      index === caseIndex ? { ...item, decision: accepted ? 'accepted' : 'declined' } : item,
    ),
  };
}

async function handleDecision(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return reply;
  const candidate = principal.candidate;
  if (!candidate)
    return sendError(
      reply,
      request,
      401,
      'unauthorized',
      'Нужна действующая сессия кандидата.',
      false,
    );
  const { runId, caseId } = paramsSchema.parse(request.params);
  const body = decisionSchema.parse(request.body);
  const run = deps.candidateStore.roleSkillAssessments.get(candidate.id, runId);
  if (!run)
    return sendError(reply, request, 404, 'assessment_not_found', 'Проверка не найдена.', false);
  const digest = requestDigest('decision', runId, { ...body, caseId });
  const replay = checkReplay(run, body.requestId, digest, request, reply);
  if (replay !== undefined) return replay;
  const caseIndex = run.cases.findIndex((record) => record.assessmentCase.id === caseId);
  const record = run.cases[caseIndex];
  if (!record)
    return sendError(reply, request, 404, 'assessment_case_not_found', 'Кейс не найден.', false);
  if (
    run.revision !== body.expectedRevision ||
    !['cases', 'complete'].includes(run.status) ||
    !isOpen(record)
  )
    return conflict(reply, request);
  const updated: RoleSkillAssessmentRun = {
    ...decidedRun(run, caseIndex, body.accepted),
    lastRequest: { id: body.requestId, digest },
  };
  return singleFlight(
    deps,
    `${candidate.id}:${runId}`,
    digest,
    () => saveRun(deps, candidate.id, updated, run.revision, reply, request),
    () => conflict(reply, request),
  );
}
