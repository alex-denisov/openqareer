import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  type CandidateCapability,
  CAPABILITY_CONSENTS_APPROVED,
  CAPABILITY_CONSENT_CURRENT_VERSION,
  isCandidateCapability,
} from '../../src/features/legal/capabilityConsents';
import type { RouteDeps } from './deps';
import {
  authenticateSession,
  csrfError,
  hasSafeMutationOrigin,
  requireVerifiedEmail,
  sendError,
  withDeps,
} from './helpers';
import { cancelFootprintRunForUser } from '../osint/candidateFootprintWorker';

const postConsentSchema = z.object({
  versionId: z.string().min(1),
});

type ConsentSubmissionResult =
  | { versionId: string }
  | { error: { status: number; code: string; message: string } };

function validateConsentSubmission(
  capability: CandidateCapability,
  body: unknown,
): ConsentSubmissionResult {
  if (!CAPABILITY_CONSENTS_APPROVED) {
    return {
      error: {
        status: 409,
        code: 'consent_text_not_approved',
        message: 'Текст согласия находится на согласовании и пока не может быть принят.',
      },
    };
  }
  const parsed = postConsentSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return {
      error: {
        status: 400,
        code: 'invalid_request',
        message: 'Поле versionId обязательно.',
      },
    };
  }
  if (parsed.data.versionId !== CAPABILITY_CONSENT_CURRENT_VERSION[capability]) {
    return {
      error: {
        status: 409,
        code: 'invalid_consent_version',
        message: 'Версия согласия устарела или не существует.',
      },
    };
  }
  return { versionId: parsed.data.versionId };
}

/** Согласие даёт только вошедший пользователь: токен кандидата без строки в users не годится. */
function resolveUserId(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): string | null | false {
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (principal && !requireVerifiedEmail(request, reply, principal)) return false;
  return principal?.userId ?? null;
}

function resolveCapability(request: FastifyRequest, reply: FastifyReply): CandidateCapability | null {
  const { capability } = request.params as { capability?: string };
  if (!capability || !isCandidateCapability(capability)) {
    sendError(reply, request, 404, 'unknown_capability', 'Неизвестная возможность профиля.', false);
    return null;
  }
  return capability;
}

async function handleGetConsent(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const resolvedUserId = resolveUserId(deps, request, reply);
  if (resolvedUserId === false) return undefined;
  const userId = resolvedUserId;
  if (!userId) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
  }
  const capability = resolveCapability(request, reply);
  if (!capability) return undefined;

  const store = deps.capabilityConsentStore;
  const consent = store ? store.getActiveConsent(userId, capability) : null;
  return {
    data: {
      capability,
      granted: consent !== null,
      consent,
    },
    meta: { requestId: request.id },
  };
}

async function handleListConsents(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const resolvedUserId = resolveUserId(deps, request, reply);
  if (resolvedUserId === false) return undefined;
  const userId = resolvedUserId;
  if (!userId) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
  }
  const store = deps.capabilityConsentStore;
  const consents = store ? store.listConsents(userId) : [];
  return {
    data: { consents },
    meta: { requestId: request.id },
  };
}

async function handlePostConsent(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) {
    return csrfError(request, reply);
  }
  const resolvedUserId = resolveUserId(deps, request, reply);
  if (resolvedUserId === false) return undefined;
  const userId = resolvedUserId;
  if (!userId) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
  }
  const capability = resolveCapability(request, reply);
  if (!capability) return undefined;

  const validation = validateConsentSubmission(capability, request.body);
  if ('error' in validation) {
    return sendError(
      reply,
      request,
      validation.error.status,
      validation.error.code,
      validation.error.message,
      false,
    );
  }
  if (!deps.capabilityConsentStore) {
    return sendError(
      reply,
      request,
      503,
      'capability_consent_unavailable',
      'Сохранение согласия временно недоступно.',
      true,
    );
  }
  const consent = deps.capabilityConsentStore.recordConsent({
    userId,
    capability,
    versionId: validation.versionId,
  });
  return {
    data: { capability, granted: true, consent },
    meta: { requestId: request.id },
  };
}

async function handleDeleteConsent(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) {
    return csrfError(request, reply);
  }
  const resolvedUserId = resolveUserId(deps, request, reply);
  if (resolvedUserId === false) return undefined;
  const userId = resolvedUserId;
  if (!userId) {
    return sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия.', false);
  }
  const capability = resolveCapability(request, reply);
  if (!capability) return undefined;

  if (!deps.capabilityConsentStore) {
    return sendError(
      reply,
      request,
      503,
      'capability_consent_unavailable',
      'Отзыв согласия временно недоступен.',
      true,
    );
  }

  if (capability === 'digital_footprint') {
    cancelFootprintRunForUser(userId);
    deps.candidateReputationRepo?.deleteFootprintAuditsByUserId(userId);
  }
  const consent = deps.capabilityConsentStore.revokeConsent(userId, capability);
  return {
    data: {
      capability,
      granted: false,
      revoked: true,
      consent,
    },
    meta: { requestId: request.id },
  };
}

export function registerCapabilityConsentRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/me/consents', withDeps(deps, handleListConsents));
  app.get('/api/v1/me/consents/:capability', withDeps(deps, handleGetConsent));
  const mutationLimit = { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } };
  app.post(
    '/api/v1/me/consents/:capability',
    mutationLimit,
    withDeps(deps, handlePostConsent),
  );
  app.delete(
    '/api/v1/me/consents/:capability',
    mutationLimit,
    withDeps(deps, handleDeleteConsent),
  );
}
