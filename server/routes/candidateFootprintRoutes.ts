import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  CAPABILITY_CONSENTS_APPROVED,
  CAPABILITY_CONSENT_CURRENT_VERSION,
} from '../../src/features/legal/capabilityConsents';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { createFootprintAdapterSet } from '../osint/adapters/createFootprintAdapters';
import {
  cancelFootprintRunForCandidate,
  FootprintConsentRequiredError,
  FootprintQueryPlanError,
  isFootprintRunActive,
  startCandidateFootprintAudit,
} from '../osint/candidateFootprintWorker';
import {
  buildCandidateFootprintQueryPlan,
  extractUnidentifiedEmployers,
  toPublicFootprintQueryPlan,
} from '../osint/candidateFootprintQueryPlan';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  authenticateSession,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

const startFootprintSchema = z.object({
  selectedQueryIds: z.array(z.string().regex(/^[a-f0-9]{20}$/u)).min(1).max(100),
  confirmedOwnership: z.literal(true),
  manualEmployers: z.array(z.string().trim().min(1).max(60)).max(10).optional(),
}).strict();
const reviewSchema = z.object({
  review: z.enum(['confirmed_self', 'not_self', 'hidden', 'unreviewed']),
}).strict();

function sourceAvailability(config: RouteDeps['config']) {
  return {
    sherlock: true,
    maigret: true,
    hibp: Boolean(config.hibpApiKey),
    wayback: true,
    exa: Boolean(config.exaApiKey),
  } as const;
}

function getPlan(deps: RouteDeps, candidateId: string, manualEmployers?: readonly string[]) {
  const draft = deps.candidateStore.getSnapshot(candidateId).resume?.draft ?? EMPTY_RESUME_DRAFT;
  const availability = sourceAvailability(deps.config);
  return {
    plan: toPublicFootprintQueryPlan(
      buildCandidateFootprintQueryPlan(draft, { manualEmployers }),
      availability,
    ),
    unidentifiedEmployers: extractUnidentifiedEmployers(draft),
    sourceAvailability: availability,
  };
}

function consentForCandidate(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
): { userId: string | null; granted: boolean } {
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal?.candidate || principal.candidate.id !== candidateId) {
    return { userId: null, granted: false };
  }
  const consent = deps.capabilityConsentStore?.getActiveConsent(principal.userId, 'digital_footprint');
  return {
    userId: principal.userId,
    granted: Boolean(
      consent && consent.versionId === CAPABILITY_CONSENT_CURRENT_VERSION.digital_footprint,
    ),
  };
}

function latestFootprintAudit(
  deps: RouteDeps,
  candidateId: string,
) {
  const repo = deps.candidateReputationRepo;
  let audit = repo?.getLatestFootprintAudit(candidateId) ?? null;
  if (audit?.state === 'pending' && !isFootprintRunActive(audit.id)) {
    audit = staleAudit(audit);
    repo?.saveFootprintAudit(audit);
  }
  return audit;
}

async function handleGetFootprintPlan(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const candidate = authenticateCandidate(
    request, reply, deps.candidateStore, deps.authService, deps.config,
  );
  if (!candidate) return undefined;
  const rawManual = (request.query as { manualEmployers?: string | string[] })?.manualEmployers;
  const manualEmployers = Array.isArray(rawManual)
    ? rawManual
    : typeof rawManual === 'string'
      ? rawManual.split(',').map((s) => s.trim()).filter(Boolean)
      : undefined;
  const consent = consentForCandidate(deps, request, candidate.id);
  const { plan, unidentifiedEmployers, sourceAvailability } = getPlan(
    deps, candidate.id, manualEmployers,
  );
  return {
    data: {
      plan,
      unidentifiedEmployers,
      sourceAvailability,
      consent: {
        approved: CAPABILITY_CONSENTS_APPROVED,
        granted: consent.granted,
        versionId: CAPABILITY_CONSENT_CURRENT_VERSION.digital_footprint,
      },
      audit: latestFootprintAudit(deps, candidate.id),
    },
    meta: { requestId: request.id },
  };
}

function staleAudit(audit: NonNullable<ReturnType<NonNullable<RouteDeps['candidateReputationRepo']>['getLatestFootprintAudit']>>) {
  return {
    ...audit,
    state: 'failed' as const,
    adapterStatuses: audit.adapterStatuses.map((status) => status.state === 'pending'
      ? { ...status, state: 'source_error' as const }
      : status),
    completedAt: new Date().toISOString(),
  };
}

async function handleGetFootprintAudit(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const candidate = authenticateCandidate(
    request, reply, deps.candidateStore, deps.authService, deps.config,
  );
  if (!candidate) return undefined;
  const audit = latestFootprintAudit(deps, candidate.id);
  return { data: { audit }, meta: { requestId: request.id } };
}

function isConsentCurrent(deps: RouteDeps, userId: string, candidateId: string): boolean {
  if (!CAPABILITY_CONSENTS_APPROVED || !deps.capabilityConsentStore) return false;
  try {
    const snapshot = deps.candidateStore.getSnapshot(candidateId);
    const consent = deps.capabilityConsentStore.getActiveConsent(userId, 'digital_footprint');
    return Boolean(
      snapshot && consent &&
      consent.versionId === CAPABILITY_CONSENT_CURRENT_VERSION.digital_footprint,
    );
  } catch {
    return false;
  }
}

function validateSelectedQueryIds(
  deps: RouteDeps,
  candidateId: string,
  selectedQueryIds: readonly string[],
  manualEmployers?: readonly string[],
): { valid: boolean; unavailable: boolean } {
  const { plan } = getPlan(deps, candidateId, manualEmployers);
  const selected = new Set(selectedQueryIds);
  const matches = plan.filter((item) => selected.has(item.id));
  return {
    valid: matches.length === selected.size,
    unavailable: matches.some((item) => !item.available),
  };
}

async function handleStartFootprintAudit(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request, reply, deps.candidateStore, deps.authService, deps.config,
  );
  if (!candidate) return undefined;
  if (!CAPABILITY_CONSENTS_APPROVED) {
    return sendError(
      reply, request, 409, 'consent_text_not_approved',
      'Скоро: ждёт утверждения текста согласия.', false,
    );
  }
  const session = authenticateSession(request, deps.authService, deps.config);
  if (!session?.candidate || session.candidate.id !== candidate.id) {
    return sendError(reply, request, 403, 'candidate_session_required', 'Нужна сессия кандидата.', false);
  }
  const userId = session.userId;
  if (!isConsentCurrent(deps, userId, candidate.id)) {
    return sendError(reply, request, 409, 'digital_footprint_consent_required', 'Сначала выдайте согласие на цифровой след.', false);
  }
  if (!deps.candidateReputationRepo) {
    return sendError(reply, request, 503, 'footprint_storage_unavailable', 'Сохранение результата временно недоступно.', true);
  }
  const parsed = startFootprintSchema.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_request', 'Подтвердите, что выбранные данные ваши, и выберите запросы.', false);
  }
  const selected = validateSelectedQueryIds(
    deps, candidate.id, parsed.data.selectedQueryIds, parsed.data.manualEmployers,
  );
  if (!selected.valid) {
    return sendError(reply, request, 409, 'query_plan_changed', 'План проверки изменился. Обновите страницу.', false);
  }
  if (selected.unavailable) {
    return sendError(reply, request, 409, 'source_not_connected', 'Один из выбранных источников не подключён.', false);
  }
  return launchFootprintRun(
    deps, request, reply, candidate.id, userId, parsed.data.selectedQueryIds,
    new Date().toISOString(), parsed.data.manualEmployers,
  );
}

async function launchFootprintRun(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
  userId: string,
  selectedQueryIds: readonly string[],
  ownershipConfirmedAt: string,
  manualEmployers?: readonly string[],
): Promise<unknown> {
  const draft = deps.candidateStore.getSnapshot(candidateId).resume?.draft ?? EMPTY_RESUME_DRAFT;
  const plan = buildCandidateFootprintQueryPlan(draft, { manualEmployers });
  try {
    const audit = startCandidateFootprintAudit({
      candidateId,
      userId,
      plan,
      selectedQueryIds,
      ownershipConfirmedAt,
      repo: deps.candidateReputationRepo!,
      adapters: createFootprintAdapterSet({ config: deps.config }),
      isAuthorized: () => isConsentCurrent(deps, userId, candidateId),
    });
    return reply.code(202).send({ data: { audit }, meta: { requestId: request.id } });
  } catch (error) {
    if (error instanceof FootprintConsentRequiredError) {
      return sendError(reply, request, 409, 'digital_footprint_consent_required', 'Согласие было отозвано. Обновите страницу.', false);
    }
    if (error instanceof FootprintQueryPlanError) {
      return sendError(reply, request, 400, 'invalid_query_plan', error.message, false);
    }
    throw error;
  }
}

async function handleReviewFootprintFinding(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request, reply, deps.candidateStore, deps.authService, deps.config,
  );
  if (!candidate) return undefined;
  const findingId = z.string().regex(/^[a-f0-9]{24}$/u).safeParse(
    (request.params as { findingId?: string }).findingId,
  );
  const decision = reviewSchema.safeParse(request.body);
  if (!findingId.success || !decision.success) {
    return sendError(reply, request, 400, 'invalid_review', 'Выберите одно из действий для находки.', false);
  }
  const latest = deps.candidateReputationRepo?.getLatestFootprintAudit(candidate.id);
  if (!latest || latest.state === 'pending') {
    return sendError(reply, request, 409, 'audit_not_complete', 'Находки можно отметить после проверки.', false);
  }
  const audit = deps.candidateReputationRepo?.updateFootprintFindingReview(
    candidate.id, findingId.data, decision.data.review,
  );
  if (!audit) return sendError(reply, request, 404, 'finding_not_found', 'Находка больше недоступна.', false);
  return { data: { audit }, meta: { requestId: request.id } };
}

async function handleDeleteFootprintFindings(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request, reply, deps.candidateStore, deps.authService, deps.config,
  );
  if (!candidate) return undefined;
  if (!deps.candidateReputationRepo) {
    return sendError(reply, request, 503, 'footprint_storage_unavailable', 'Удаление результатов временно недоступно.', true);
  }
  cancelFootprintRunForCandidate(candidate.id);
  deps.candidateReputationRepo.deleteFootprintAuditsByCandidateId(candidate.id);
  return reply.code(204).send();
}

export function registerCandidateFootprintRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get('/api/v1/candidate/footprint/plan', withDeps(deps, handleGetFootprintPlan));
  app.get('/api/v1/candidate/footprint', withDeps(deps, handleGetFootprintAudit));
  app.post(
    '/api/v1/candidate/footprint/start',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    withDeps(deps, handleStartFootprintAudit),
  );
  app.patch(
    '/api/v1/candidate/footprint/findings/:findingId',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleReviewFootprintFinding),
  );
  app.delete(
    '/api/v1/candidate/footprint',
    { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } },
    withDeps(deps, handleDeleteFootprintFindings),
  );
}
