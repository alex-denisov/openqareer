import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RoleSkillAssessmentRun } from '../domain/roleSkillAssessment';
import type { RouteDeps } from './deps';
import { sendError, withDeps } from './helpers';
import {
  actionSchema,
  checkReplay,
  conflict,
  requestDigest,
  requireMutationCandidate,
  saveRun,
  singleFlight,
} from './roleSkillAssessmentRouteSupport';

const paramsSchema = z.object({ runId: z.string().uuid(), caseId: z.string().min(1).max(240) });
const OPEN_STATUSES: ReadonlySet<RoleSkillAssessmentRun['status']> = new Set(['cases', 'complete']);

/** B734 «Дальше без изменений»: итог кейса остаётся в проверке, но не идёт в профиль. */
export function registerRoleSkillKeepOutRoute(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/role-skill-assessments/:runId/cases/:caseId/keep-out',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    withDeps(deps, handleKeepOut),
  );
}

/** Confirmed skills except those whose case result the candidate kept out of the profile. */
export function profileSkills(run: RoleSkillAssessmentRun): string[] {
  const keptOut = new Set(
    run.cases.filter((record) => record.keptOutOfProfile).map((record) => record.assessmentCase.id),
  );
  return run.skills
    .filter((skill) => skill.grade === 'confirmed' && !(skill.caseId && keptOut.has(skill.caseId)))
    .map((skill) => skill.name);
}

async function handleKeepOut(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = await requireMutationCandidate(deps, request, reply);
  if (!candidate) return undefined;
  const { runId, caseId } = paramsSchema.parse(request.params);
  const body = actionSchema.parse(request.body);
  const run = deps.candidateStore.roleSkillAssessments.get(candidate.id, runId);
  if (!run)
    return sendError(reply, request, 404, 'assessment_not_found', 'Проверка не найдена.', false);
  const digest = requestDigest('keep-out', runId, { ...body, caseId });
  const replay = checkReplay(run, body.requestId, digest, request, reply);
  if (replay !== undefined) return replay;
  if (run.revision !== body.expectedRevision || !OPEN_STATUSES.has(run.status))
    return conflict(reply, request);
  const caseIndex = run.cases.findIndex((record) => record.assessmentCase.id === caseId);
  if (caseIndex < 0 || !run.cases[caseIndex]?.evaluation) return conflict(reply, request);

  const updated: RoleSkillAssessmentRun = {
    ...run,
    revision: run.revision + 1,
    updatedAt: new Date().toISOString(),
    cases: run.cases.map((record, index) =>
      index === caseIndex ? { ...record, keptOutOfProfile: true as const } : record,
    ),
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
