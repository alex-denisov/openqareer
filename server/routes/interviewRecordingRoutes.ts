import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import { registerInterviewDebriefRoutes } from './interviewDebriefRoutes';
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

/** B751: `upload` — файл с сайта; без тела — запись .app. */
const createSchema = z
  .object({
    source: z.enum(['app', 'upload']).optional(),
    /** «Продолжить» после сбоя .app: новая часть той же записи. */
    continues: z.string().uuid().optional(),
  })
  .optional()
  .nullable();

const LIMIT = { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } };

function notFound(reply: FastifyReply, request: FastifyRequest): FastifyReply {
  return sendError(reply, request, 404, 'recording_not_found', 'Запись не найдена.', false);
}

/** Адрес приёма сегментов и ключ записи — их .app передаёт в `recording_start`. */
function sendCreated(
  reply: FastifyReply,
  request: FastifyRequest,
  config: RouteDeps['config'],
  recordingId: string,
  issued: ReturnType<typeof issueRecordingToken>,
): FastifyReply {
  return reply.code(201).send({
    data: {
      recordingId,
      uploadUrl: `${publicOrigin(config)}/api/v1/candidate/recordings/${recordingId}/segments`,
      headers: { 'X-Recording-Token': issued.token },
      expiresAt: issued.expiresAt,
    },
    meta: { requestId: request.id },
  });
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
  const body = createSchema.safeParse(request.body);
  if (!body.success) {
    return sendError(reply, request, 400, 'invalid_recording', 'Неверный источник записи.', false);
  }
  const continues = body.data?.continues
    ? repository.getOwned(candidate.id, body.data.continues)
    : null;
  if (body.data?.continues && continues?.interviewId !== params.iid) {
    return sendError(reply, request, 400, 'invalid_recording', 'Неверный источник записи.', false);
  }
  const issued = issueRecordingToken();
  const recordingId = repository.create({
    candidateId: candidate.id,
    applicationId: params.id,
    interviewId: params.iid,
    tokenHash: issued.tokenHash,
    tokenExpiresAt: issued.expiresAt,
    source: body.data?.source ?? 'app',
    continuesId: continues?.id ?? null,
  });
  return sendCreated(reply, request, config, recordingId, issued);
};

/**
 * Диктовка ответа в .app (i02/i03), где нет распознавания речи браузером: та же запись
 * B642, но без интервью; клиент читает текст и удаляет запись.
 */
const handleCreateDictation: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { repository } = recordingRuntimeFor(deps, request.log);
  const issued = issueRecordingToken();
  const recordingId = repository.create({
    candidateId: candidate.id,
    applicationId: '',
    interviewId: '',
    tokenHash: issued.tokenHash,
    tokenExpiresAt: issued.expiresAt,
    source: 'dictation',
  });
  return sendCreated(reply, request, config, recordingId, issued);
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
  app.post('/api/v1/candidate/dictations', LIMIT, withDeps(deps, handleCreateDictation));
  app.get('/api/v1/candidate/recordings/:recordingId', LIMIT, withDeps(deps, handleGet));
  app.post('/api/v1/candidate/recordings/:recordingId/finish', LIMIT, withDeps(deps, handleFinish));
  app.delete('/api/v1/candidate/recordings/:recordingId', LIMIT, withDeps(deps, handleDelete));
  registerRecordingSegmentRoute(app, deps);
  registerInterviewDebriefRoutes(app, deps);
}
