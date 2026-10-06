import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  advanceReferral,
  newReferralTrack,
  pitchViolations,
  type ReferralEvent,
} from '../../shared/referralTrack';
import type { StoredReferralTrack } from '../data/sqliteReferralTrackRepository';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { putReferralTrackSchema, type ReferralTrackInput } from './referralTrackValidation';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const EMPTY = (applicationId: string) => ({
  applicationId,
  contact: null,
  track: null,
  version: 0,
  updatedAt: null,
});

const handleGetReferralTrack: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const applicationId = (request.params as { id: string }).id;
  if (!candidateStore.getApplication(candidate.id, applicationId)) {
    return sendError(reply, request, 404, 'application_not_found', 'Отклик не найден', false);
  }
  const stored = candidateStore.referralTrackRepo.get(candidate.id, applicationId);
  return { data: stored ?? EMPTY(applicationId), meta: { requestId: request.id } };
};

function toEvent(input: Exclude<ReferralTrackInput, { action: 'select' }>): ReferralEvent {
  switch (input.action) {
    case 'draft_pitch':
      return { type: 'draft_pitch', pitch: input.pitch };
    case 'candidate_sent_request':
      return { type: 'candidate_sent_request' };
    case 'record_reply':
      return { type: 'record_reply', outcome: input.outcome };
    case 'mark_no_reply':
      return { type: 'mark_no_reply' };
  }
}

function transitionError(reply: FastifyReply, request: FastifyRequest, message: string) {
  return sendError(reply, request, 409, 'referral_transition_not_allowed', message, false);
}

function applyAction(
  input: ReferralTrackInput,
  current: StoredReferralTrack | null,
  now: string,
): { contact: StoredReferralTrack['contact']; track: StoredReferralTrack['track'] } {
  if (input.action === 'select') {
    if (current && current.track.status !== 'selected' && current.track.status !== 'pitch_ready') {
      throw new Error('Контакт нельзя менять после отправки запроса');
    }
    const contact = {
      name: input.contact.name,
      role: input.contact.role ?? null,
      profileUrl: input.contact.profileUrl ?? null,
    };
    return { contact, track: newReferralTrack(randomUUID(), now) };
  }
  if (!current) throw new Error('Сначала выберите контакт');
  return { contact: current.contact, track: advanceReferral(current.track, toEvent(input), now) };
}

const handlePutReferralTrack: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const applicationId = (request.params as { id: string }).id;
  const body = putReferralTrackSchema.parse(request.body);
  if (!candidateStore.getApplication(candidate.id, applicationId)) {
    return sendError(reply, request, 404, 'application_not_found', 'Отклик не найден', false);
  }
  if (body.action === 'draft_pitch' && pitchViolations(body.pitch).length > 0) {
    return sendError(
      reply,
      request,
      422,
      'referral_pitch_not_allowed',
      'Питч содержит давление или выдаёт знакомство за личную работу вместе',
      false,
    );
  }
  const repo = candidateStore.referralTrackRepo;
  const now = new Date().toISOString();
  try {
    const next = applyAction(body, repo.get(candidate.id, applicationId), now);
    const stored = repo.put(candidate.id, applicationId, next.contact, next.track, now);
    return { data: stored, meta: { requestId: request.id } };
  } catch (error) {
    return transitionError(reply, request, error instanceof Error ? error.message : 'Недопустимый переход');
  }
};

/** `GET/PUT /applications/:id/referral-track` (B389): продукт ничего не отправляет, только фиксирует действия кандидата. */
export function registerReferralTrackRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/applications/:id/referral-track',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handleGetReferralTrack),
  );
  app.put(
    '/api/v1/candidate/applications/:id/referral-track',
    { config: { rateLimit: { max: 240, timeWindow: '1 hour' } } },
    withDeps(deps, handlePutReferralTrack),
  );
}
