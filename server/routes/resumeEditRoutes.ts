import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { resumeEditDecisionSchema, type ResumeEditChoices } from '../../shared/resumeVacancyEdits';
import type { SqliteResumeEditChoicesRepository } from '../candidate/sqliteResumeEditChoicesRepository';
import {
  editSource,
  keepsSourceNumbers,
  resumeVacancyEdits,
  withDecision,
} from '../domain/resumeVacancyEdits';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { resolveRowVacancyCluster } from '../vacancies/poolVacancyCluster';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { letterResumeKind, targetedSliceFor } from './letterApprovalResume';
import { currentMaster } from './resumeMaster';

export type ResumeEditDeps = RouteDeps & {
  readonly resumeEdits: SqliteResumeEditChoicesRepository;
};

const PATH = '/api/v1/candidate/vacancies/:id/resume-edits';

function context(deps: ResumeEditDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const cluster = resolveRowVacancyCluster(
    deps.multiSourceEngine,
    (request.params as { id: string }).id,
  );
  if (!cluster) {
    sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
    return undefined;
  }
  return { candidateId: candidate.id, cluster };
}

/** Общее резюме (Free) под вакансию не меняется: правок у него нет. */
function sliceOf(deps: RouteDeps, candidateId: string, cluster: VacancyCluster) {
  if (letterResumeKind(deps, candidateId) === 'master') return null;
  return targetedSliceFor(currentMaster(deps, candidateId), cluster);
}

async function handleRead(deps: ResumeEditDeps, request: FastifyRequest, reply: FastifyReply) {
  const found = context(deps, request, reply);
  if (!found) return undefined;
  const slice = sliceOf(deps, found.candidateId, found.cluster);
  const choices = deps.resumeEdits.read(found.candidateId, found.cluster.id);
  reply.header('cache-control', 'private, no-store');
  return {
    data: { edits: slice ? resumeVacancyEdits(slice, choices) : [] },
    meta: { requestId: request.id },
  };
}

async function handleDecide(deps: ResumeEditDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const found = context(deps, request, reply);
  if (!found) return undefined;
  const parsed = resumeEditDecisionSchema.safeParse(request.body);
  if (!parsed.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_resume_edit',
      'Правка не прошла проверку.',
      false,
    );
  }
  const slice = sliceOf(deps, found.candidateId, found.cluster);
  const source = slice ? editSource(slice, parsed.data.id) : null;
  if (!slice || source === null) {
    return sendError(
      reply,
      request,
      409,
      'resume_edit_stale',
      'Резюме изменилось. Откройте его снова.',
      false,
    );
  }
  if (parsed.data.action === 'text' && !keepsSourceNumbers(parsed.data.text, source)) {
    return sendError(
      reply,
      request,
      422,
      'resume_edit_numbers',
      'Этого числа нет в профиле.',
      false,
    );
  }
  const current = deps.resumeEdits.read(found.candidateId, found.cluster.id);
  const choices: ResumeEditChoices = withDecision(current, parsed.data, source);
  deps.resumeEdits.save(found.candidateId, found.cluster.id, choices, new Date().toISOString());
  return { data: { edits: resumeVacancyEdits(slice, choices) }, meta: { requestId: request.id } };
}

/** B785, o03: правки резюме под вакансию — список и решения кандидата. */
export function registerResumeEditRoutes(app: FastifyInstance, deps: ResumeEditDeps): void {
  app.get(PATH, withDeps(deps, handleRead));
  app.put(PATH, { bodyLimit: 8 * 1_024 }, withDeps(deps, handleDecide));
}
