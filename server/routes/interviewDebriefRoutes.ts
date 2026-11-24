import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { recordingRuntimeFor, failStaleSegments } from '../recordings/recordingRuntime';
import {
  analyzeDebrief,
  buildDebriefView,
  confirmDebriefVoices,
  debriefInterview,
  labelDebriefVoices,
  saveInterviewerName,
  type DebriefContext,
} from '../recordings/interviewDebriefService';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const notesSchema = z.object({ notes: z.string().max(10_000) });
const agreementSchema = z.object({ text: z.string().trim().min(1).max(500) });
const interviewerSchema = z.object({ name: z.string().max(120) });
const voicesSchema = z.object({ candidate: z.union([z.literal(1), z.literal(2)]) });

const READ = { config: { rateLimit: { max: 600, timeWindow: '1 hour' } } };
const WRITE = { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } };

interface Resolved {
  readonly candidateId: string;
  readonly applicationId: string;
  readonly context: DebriefContext;
  readonly subject: Parameters<typeof buildDebriefView>[1];
}

/** Кандидат, его отклик и интервью для разбора; иначе ответ уже отправлен. */
function resolve(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  mutation: boolean,
): Resolved | null {
  const { authService, candidateStore, config } = deps;
  if (mutation && !hasSafeMutationOrigin(request, config)) {
    csrfError(request, reply);
    return null;
  }
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return null;
  const applicationId = (request.params as { id: string }).id;
  const runtime = recordingRuntimeFor(deps, request.log);
  const interview = candidateStore.getApplication(candidate.id, applicationId)
    ? debriefInterview(runtime.interviews.list(applicationId))
    : null;
  if (!interview) {
    sendError(reply, request, 404, 'interview_not_found', 'Интервью не найдено.', false);
    return null;
  }
  failStaleSegments(runtime);
  const context = {
    repository: runtime.repository,
    sealedText: runtime.sealedText,
    writer: runtime.debriefWriter,
  };
  return {
    candidateId: candidate.id,
    applicationId,
    context,
    subject: { candidateId: candidate.id, interview },
  };
}

function invalid(reply: FastifyReply, request: FastifyRequest): FastifyReply {
  return sendError(reply, request, 400, 'invalid_debrief', 'Неверные данные разбора.', false);
}

const viewBody = (resolved: Resolved, request: FastifyRequest) => ({
  data: buildDebriefView(resolved.context, resolved.subject),
  meta: { requestId: request.id },
});

const handleGet: Handler = async (deps, request, reply) => {
  const resolved = resolve(deps, request, reply, false);
  if (!resolved) return undefined;
  return reply.header('Cache-Control', 'no-store').send(viewBody(resolved, request));
};

const handleAnalysis: Handler = async (deps, request, reply) => {
  const resolved = resolve(deps, request, reply, true);
  if (!resolved) return undefined;
  const data = await analyzeDebrief(resolved.context, resolved.subject);
  return reply.header('Cache-Control', 'no-store').send({ data, meta: { requestId: request.id } });
};

const handleNotes: Handler = async (deps, request, reply) => {
  const resolved = resolve(deps, request, reply, true);
  if (!resolved) return undefined;
  const body = notesSchema.safeParse(request.body);
  if (!body.success) return invalid(reply, request);
  const interview = deps.candidateStore.patchApplicationInterview(
    resolved.candidateId,
    resolved.applicationId,
    resolved.subject.interview.id,
    { debrief: body.data.notes.trim() || null },
  );
  return reply
    .header('Cache-Control', 'no-store')
    .send(viewBody({ ...resolved, subject: { ...resolved.subject, interview } }, request));
};

/** «Верно — в отклик»: договорённость дописывается строкой в заметки отклика. */
const handleAgreement: Handler = async (deps, request, reply) => {
  const resolved = resolve(deps, request, reply, true);
  if (!resolved) return undefined;
  const body = agreementSchema.safeParse(request.body);
  if (!body.success) return invalid(reply, request);
  const { candidateStore } = deps;
  const application = candidateStore.getApplication(resolved.candidateId, resolved.applicationId);
  if (!application) return invalid(reply, request);
  const notes = [application.notes?.trim(), body.data.text].filter(Boolean).join('\n');
  candidateStore.patchApplication(resolved.candidateId, resolved.applicationId, {
    expectedVersion: application.version,
    notes,
  });
  return { data: { saved: true }, meta: { requestId: request.id } };
};

const handleInterviewer: Handler = async (deps, request, reply) => {
  const resolved = resolve(deps, request, reply, true);
  if (!resolved) return undefined;
  const body = interviewerSchema.safeParse(request.body);
  if (!body.success) return invalid(reply, request);
  saveInterviewerName(resolved.context, resolved.subject, body.data.name);
  return { data: { saved: true }, meta: { requestId: request.id } };
};

/** I4c «Чей голос»: деление голосов загруженного файла — один вызов модели на расшифровку. */
const handleVoices: Handler = async (deps, request, reply) => {
  const resolved = resolve(deps, request, reply, true);
  if (!resolved) return undefined;
  const data = await labelDebriefVoices(resolved.context, resolved.subject);
  return reply.header('Cache-Control', 'no-store').send({ data, meta: { requestId: request.id } });
};

/** «Подтвердить голоса»: какой голос — кандидата. */
const handleVoicesConfirm: Handler = async (deps, request, reply) => {
  const resolved = resolve(deps, request, reply, true);
  if (!resolved) return undefined;
  const body = voicesSchema.safeParse(request.body);
  if (!body.success) return invalid(reply, request);
  if (!confirmDebriefVoices(resolved.context, resolved.subject, body.data.candidate)) {
    return sendError(reply, request, 409, 'voices_not_ready', 'Голоса ещё не разделены.', false);
  }
  return reply.header('Cache-Control', 'no-store').send(viewBody(resolved, request));
};

/** B751: разбор после интервью — I4, запись I4b и файл I4c читают один ответ. */
export function registerInterviewDebriefRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const base = '/api/v1/candidate/applications/:id/debrief';
  app.get(base, READ, withDeps(deps, handleGet));
  app.post(`${base}/analysis`, WRITE, withDeps(deps, handleAnalysis));
  app.put(`${base}/notes`, WRITE, withDeps(deps, handleNotes));
  app.post(`${base}/agreements`, WRITE, withDeps(deps, handleAgreement));
  app.put(`${base}/interviewer`, WRITE, withDeps(deps, handleInterviewer));
  app.post(`${base}/voices`, WRITE, withDeps(deps, handleVoices));
  app.put(`${base}/voices`, WRITE, withDeps(deps, handleVoicesConfirm));
}
