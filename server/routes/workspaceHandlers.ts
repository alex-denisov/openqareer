import { z } from 'zod';
import {
  candidateWorkspaceSchema,
  type CandidateWorkspaceState,
} from '../domain/candidateWorkspace';
import type { Handler } from './candidateRoutes';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin } from './helpers';

export const handleGetWorkspace: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  return {
    data: candidateStore.getCandidateWorkspace(candidate.id),
    meta: { requestId: request.id },
  };
};

/**
 * The wizard's answers are the candidate's own words; no engine can recompute
 * them. Keeping them only in browser storage meant signing out erased the
 * candidate's career context (INC-024).
 */
export const handlePutWorkspace: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = z.object({ workspace: candidateWorkspaceSchema }).strict().parse(request.body);
  const stored = candidateStore.getCandidateWorkspace(candidate.id);
  return {
    data: candidateStore.saveCandidateWorkspace(candidate.id, {
      ...body.workspace,
      ...serverOwnedWorkspaceFields(stored),
    }),
    meta: { requestId: request.id },
  };
};

/**
 * Кампанию и отметки визита пишет только сервер (`/campaign`, пересборка ролей,
 * `/today`). Клиент шлёт свою часть рабочего пространства целиком — без этих
 * полей замена стирала роли кандидата и сдвигала «с прошлого визита».
 */
function serverOwnedWorkspaceFields(
  stored: CandidateWorkspaceState | null,
): Partial<Pick<CandidateWorkspaceState, 'campaign' | 'lastVisitedAt' | 'previousVisitedAt'>> {
  if (!stored) return {};
  return {
    ...(stored.campaign ? { campaign: stored.campaign } : {}),
    ...(stored.lastVisitedAt ? { lastVisitedAt: stored.lastVisitedAt } : {}),
    ...(stored.previousVisitedAt ? { previousVisitedAt: stored.previousVisitedAt } : {}),
  };
}
