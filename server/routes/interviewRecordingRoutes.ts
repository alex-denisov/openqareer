import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { registerRecordingSegmentRoute } from './interviewRecordingSegmentRoute';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { issueRecordingToken } from '../recordings/recordingToken';
import {
  closeRecordingRuntime,
  failStaleSegments,
  publicOrigin,
  recordingRuntimeFor,
} from '../recordings/recordingRuntime';
import { buildRecordingView } from '../recordings/recordingView';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const finishSchema = z.object({
  segments: z.number().int().min(0),
  failed: z.number().int().min(0),
});

const LIMIT = { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } };

function notFound(reply: FastifyReply, request: FastifyRequest): FastifyReply {
  return sendError(reply, request, 404, 'recording_not_found', 'Запись не найдена.', false);
}

const handleCreate: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const params = request.params as { id: string; iid: string };
  const { repository } = recordingRuntimeFor(deps, request.log);
  if (!repository.interviewBelongsTo(candidate.id, params.id, params.iid)) {
    return sendError(reply, request, 404, 'interview_not_found', 'Интервью не найдено.', false);
  }
  const issued = issueRecordingToken();
  const recordingId = repository.create({
    candidateId: candidate.id,
    applicationId: params.id,
    interviewId: params.iid,
    tokenHash: issued.tokenHash,
    tokenExpiresAt: issued.expiresAt,
  });
  return reply.code(201).send({
    data: {
      recordingId,
      uploadUrl: `${publicOrigin(config)}/api/v1/candidate/recordings/${recordingId}/segments`,
      headers: { 'X-Recording-Token': issued.token },
      expiresAt: issued.expiresAt,
    },
    meta: { requestId: request.id },
  });
};

function viewOf(deps: RouteDeps, request: FastifyRequest, recordingId: string) {
  const runtime = recordingRuntimeFor(deps, request.log);
  failStaleSegments(runtime);
  const { repository, sealedText } = runtime;
  const recording = repository.getById(recordingId);
  return recording
    ? {
        data: buildRecordingView(sealedText, recording, repository.listSegments(recordingId)),
        meta: { requestId: request.id },
      }
    : null;
}

const handleGet: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const id = (request.params as { recordingId: string }).recordingId;
  const owned = recordingRuntimeFor(deps, request.log).repository.getOwned(candidate.id, id);
  const body = owned ? viewOf(deps, request, id) : null;
  if (!body) return notFound(reply, request);
  return reply.header('Cache-Control', 'no-store').send(body);
};

const handleFinish: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const id = (request.params as { recordingId: string }).recordingId;
  const { repository } = recordingRuntimeFor(deps, request.log);
  if (!repository.getOwned(candidate.id, id)) return notFound(reply, request);
  const body = finishSchema.safeParse(request.body);
  if (!body.success) {
    return sendError(
      reply,
      request,
      400,
      'invalid_finish',
      'Неверные данные завершения записи.',
      false,
    );
  }
  repository.finish(id, body.data.segments, body.data.failed);
  return reply.header('Cache-Control', 'no-store').send(viewOf(deps, request, id));
};

const handleDelete: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const id = (request.params as { recordingId: string }).recordingId;
  const { repository } = recordingRuntimeFor(deps, request.log);
  if (!repository.getOwned(candidate.id, id)) return notFound(reply, request);
  repository.deleteRecording(id);
  return { data: { recordingId: id, deleted: true }, meta: { requestId: request.id } };
};

/** B642: запись собеседования из .app — создание, приём сегментов, итог, удаление. */
export function registerInterviewRecordingRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.addHook('onClose', () => closeRecordingRuntime(deps));
  app.post(
    '/api/v1/candidate/applications/:id/interviews/:iid/recordings',
    LIMIT,
    withDeps(deps, handleCreate),
  );
  app.get('/api/v1/candidate/recordings/:recordingId', LIMIT, withDeps(deps, handleGet));
  app.post('/api/v1/candidate/recordings/:recordingId/finish', LIMIT, withDeps(deps, handleFinish));
  app.delete('/api/v1/candidate/recordings/:recordingId', LIMIT, withDeps(deps, handleDelete));
  registerRecordingSegmentRoute(app, deps);
}
