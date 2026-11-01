import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ResumeRevisionConflictError } from '../orchestration/careerCommandDispatcher';
import {
  confirmExperience,
  listProfileHistory,
  ProfileChangeAlreadyRevertedError,
  ProfileChangeConflictError,
  ProfileChangeNotFoundError,
  revertProfileChange,
} from '../orchestration/profileHistory';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const pageQuery = z.object({ page: z.coerce.number().int().min(0).max(10_000).default(0) });
// Consultant edits accepted before the change log are listed as `revision:<id>`.
const changeParams = z.object({
  changeId: z.string().regex(/^(revision:)?[0-9a-f-]{36}$/i),
});
const experienceParams = z.object({ experienceId: z.string().min(1).max(200) });

const signedIn = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) =>
  authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);

function signedInMutation(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) {
    csrfError(request, reply);
    return null;
  }
  return signedIn(deps, request, reply);
}

const handleList: Handler = async (deps, request, reply) => {
  const candidate = signedIn(deps, request, reply);
  if (!candidate) return undefined;
  const { page } = pageQuery.parse(request.query);
  return {
    data: listProfileHistory(deps.candidateStore, candidate.id, page),
    meta: { requestId: request.id },
  };
};

const handleRevert: Handler = async (deps, request, reply) => {
  const candidate = signedInMutation(deps, request, reply);
  if (!candidate) return undefined;
  const { changeId } = changeParams.parse(request.params);
  const dispatcher = deps.careerCommandDispatcher;
  try {
    await revertProfileChange(deps.candidateStore, candidate.id, changeId, async (commandId) => {
      if (!dispatcher) throw new Error('career_command_dispatcher_not_available');
      return dispatcher.revert(candidate.id, commandId);
    });
  } catch (error) {
    if (error instanceof ProfileChangeNotFoundError) {
      return sendError(reply, request, 404, 'profile_change_not_found', error.message, false);
    }
    if (error instanceof ProfileChangeAlreadyRevertedError) {
      return sendError(
        reply,
        request,
        409,
        'profile_change_already_reverted',
        error.message,
        false,
      );
    }
    if (
      error instanceof ProfileChangeConflictError ||
      error instanceof ResumeRevisionConflictError
    ) {
      const message = new ProfileChangeConflictError().message;
      return sendError(reply, request, 409, 'profile_change_conflict', message, false);
    }
    throw error;
  }
  return { data: { reverted: true }, meta: { requestId: request.id } };
};

const handleConfirmExperience: Handler = async (deps, request, reply) => {
  const candidate = signedInMutation(deps, request, reply);
  if (!candidate) return undefined;
  const { experienceId } = experienceParams.parse(request.params);
  if (!confirmExperience(deps.candidateStore, candidate.id, experienceId)) {
    return sendError(
      reply,
      request,
      404,
      'experience_not_found',
      'Место работы не найдено.',
      false,
    );
  }
  return { data: { confirmed: true }, meta: { requestId: request.id } };
};

export async function registerProfileHistoryRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get('/api/v1/candidate/profile/history', withDeps(deps, handleList));
  app.post('/api/v1/candidate/profile/history/:changeId/revert', withDeps(deps, handleRevert));
  app.post(
    '/api/v1/candidate/profile/experience/:experienceId/confirm',
    withDeps(deps, handleConfirmExperience),
  );
}
