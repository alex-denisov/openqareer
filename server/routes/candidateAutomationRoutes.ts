import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  DEFAULT_CANDIDATE_ACTION_LIMITS,
  isAllowedCandidateActionTarget,
  isWithinQuietHours,
} from '../../shared/candidateActionPolicy';
import { DEFAULT_ACCOUNT_TIMEZONE, formatLocalDate, isValidTimezone } from '../../shared/timezoneUtils';
import { matchCandidateWithVacancy } from '../vacancies/vacancyMatcher';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import {
  companyStopKey,
  matchesCandidateAutomationRules,
  transitionCandidateAutomationQueue,
  type CandidateAutomationOpportunity,
  type CandidateAutomationPlatform,
  type CandidateAutomationQueueAction,
  type CandidateAutomationQueueStatus,
  type CandidateAutomationRules,
} from '../domain/candidateAutomation';
import {
  DEFAULT_CANDIDATE_AUTOMATION_RULES,
  MAX_OPEN_CANDIDATE_AUTOMATION_ITEMS,
  SqliteCandidateAutomationRepository,
  type CandidateAutomationConsentKey,
  type CandidateAutomationMode,
  type CandidateAutomationQueueItem,
} from '../candidate/sqliteCandidateAutomationRepository';
import type { CandidateIdentity, CandidateSnapshot } from '../data/candidateStore';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  authenticateSession,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { registerCandidateAutomationScheduleRoutes } from './candidateAutomationScheduleRoutes';

const CONSENT_VERSION = 'B452-2026-10-10-v1';
const CONSENT_TEXT: Readonly<Record<CandidateAutomationConsentKey, string>> = {
  drafts: 'Разрешаю готовить черновики откликов и писем по выбранным мной вакансиям.',
  send_after_approval: 'Разрешаю отправлять каждый отклик только после моего отдельного одобрения.',
  notifications: 'Разрешаю показывать очередь и журнал автооткликов в уведомлениях приложения.',
  automatic_submission: 'Разрешаю отправлять подходящие отклики без отдельного одобрения каждого, в рамках выбранных правил и тарифных лимитов.',
};
const REQUIRED_CONSENTS: readonly CandidateAutomationConsentKey[] = [
  'drafts', 'send_after_approval', 'notifications',
];
const OPEN_QUEUE_STATUSES: readonly CandidateAutomationQueueStatus[] = [
  'letter_not_ready', 'pending_approval', 'approved',
];

type AutomationDeps = RouteDeps & {
  readonly automationRepository: SqliteCandidateAutomationRepository;
};
type Handler = (deps: AutomationDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const modeSchema = z.enum(['drafts_only', 'approval_required', 'automatic']);
const consentKeySchema = z.enum(['drafts', 'send_after_approval', 'notifications', 'automatic_submission']);
const rulesSchema = z.object({
  roles: z.array(z.string().trim().min(1).max(120)).max(20),
  minimumMatchPercent: z.number().int().min(0).max(100),
  platforms: z.array(z.enum(['hh', 'linkedin'])).min(1).max(2),
  excludeStopCompanies: z.boolean(),
}).strict().refine((rules) => new Set(rules.roles.map((role) => role.toLowerCase())).size === rules.roles.length, 'duplicate_roles');
const enableSchema = z.object({
  mode: modeSchema,
  consentKeys: z.array(consentKeySchema).min(1).max(4),
  rules: rulesSchema.optional(),
}).strict();
const queueRefreshSchema = z.object({
  opportunities: z.array(z.object({
    clusterId: z.string().trim().min(1).max(200),
    applicationId: z.string().trim().min(1).max(100).optional(),
    letterText: z.string().max(5_000).optional(),
    materialDocumentIds: z.array(z.string().trim().min(1).max(200)).max(4).default([]),
  }).strict()).min(1).max(100),
}).strict().refine((body) => new Set(body.opportunities.map((item) => item.clusterId)).size === body.opportunities.length, 'duplicate_cluster_ids');
const queueListSchema = z.object({
  status: z.enum(['letter_not_ready', 'pending_approval', 'approved', 'removed', 'consultant', 'sent', 'attempted', 'failed']).optional(),
  platform: z.enum(['hh', 'linkedin']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}).strict();
const queueIdSchema = z.object({ id: z.string().uuid() });
const actionSchema = z.object({ action: z.enum(['approve_and_send', 'remove', 'stop_company', 'consultant']) }).strict();
const bulkSchema = z.object({
  filter: z.object({
    status: z.enum(['letter_not_ready', 'pending_approval', 'approved', 'removed', 'consultant', 'sent', 'attempted', 'failed']),
    platform: z.enum(['hh', 'linkedin']).optional(),
  }).strict(),
  action: z.enum(['approve_and_send', 'remove', 'stop_company', 'consultant']),
}).strict();
const companySchema = z.object({ company: z.string().trim().min(1).max(300) }).strict();
const pauseSchema = z.object({ days: z.number().int().min(1).max(365) }).strict();
const importRejectedSchema = z.object({
  applicationIds: z.array(z.string().trim().min(1).max(100)).min(1).max(100),
}).strict().refine((input) => new Set(input.applicationIds).size === input.applicationIds.length, 'duplicate_application_ids');

function authenticate(
  deps: AutomationDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  mutate = false,
): CandidateIdentity | null {
  if (mutate && !hasSafeMutationOrigin(request, deps.config)) { csrfError(request, reply); return null; }
  return authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
}

function accountUser(deps: AutomationDeps, request: FastifyRequest, candidateId: string) {
  const principal = authenticateSession(request, deps.authService, deps.config);
  if (!principal || principal.candidate?.id !== candidateId || !deps.authService.getUser) return null;
  return deps.authService.getUser(principal.userId);
}

function hasActivePro(deps: AutomationDeps, request: FastifyRequest, candidateId: string): boolean {
  const user = accountUser(deps, request, candidateId);
  if (user?.subscriptionTier !== 'pro') return false;
  if (user.subscriptionStatus !== 'active' && user.subscriptionStatus !== 'trialing') return false;
  return !user.subscriptionExpiresAt || new Date(user.subscriptionExpiresAt).getTime() > Date.now();
}

function accountTimezone(deps: AutomationDeps, request: FastifyRequest, candidateId: string): string {
  const timezone = accountUser(deps, request, candidateId)?.timezone;
  return timezone && isValidTimezone(timezone) ? timezone : DEFAULT_ACCOUNT_TIMEZONE;
}

const getAutomationState: Handler = async (deps, request, reply) => {
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  return reply.send({ data: stateResponse(deps, candidate.id) });
};

function deliveryStats(deps: AutomationDeps, candidateId: string) {
  const repository = deps.automationRepository.schedulerRepository;
  const now = new Date();
  const timezone = repository.getSchedule(candidateId).timezone;
  return repository.deliveryStats(candidateId, formatLocalDate(now, timezone), now.toISOString());
}

function stateResponse(deps: AutomationDeps, candidateId: string) {
  return {
    settings: deps.automationRepository.getSettings(candidateId),
    consents: deps.automationRepository.listConsents(candidateId),
    stopCompanies: deps.automationRepository.listStopCompanies(candidateId),
    queueCounts: deps.automationRepository.queueCounts(candidateId),
    deliveryStats: deliveryStats(deps, candidateId),
    schedule: deps.automationRepository.schedulerRepository.getSchedule(candidateId),
    schedulerRuntime: deps.automationRepository.schedulerRepository.getRuntime(candidateId),
    linkedinPublishing: { enabled: false, reason: 'Публикацию в LinkedIn подтверждает и запускает кандидат (PRB-003).' },
  };
}

const enableAutomation: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const parsed = enableSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_automation_consent', 'Проверьте режим и обязательные согласия.', false);
  return enableWithConsents(deps, request, reply, candidate.id, parsed.data);
};

function enableWithConsents(
  deps: AutomationDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
  input: z.infer<typeof enableSchema>,
) {
  const consentKeys = new Set(input.consentKeys);
  if (REQUIRED_CONSENTS.some((key) => !consentKeys.has(key))) {
    return sendError(reply, request, 400, 'required_consent_missing', 'Для включения нужны три согласия из окна.', false);
  }
  if (input.mode === 'automatic' && !consentKeys.has('automatic_submission')) {
    return sendError(reply, request, 400, 'automatic_consent_required', 'Для автоматической отправки нужно отдельное согласие.', false);
  }
  if (consentKeys.has('automatic_submission') && !hasActivePro(deps, request, candidateId)) {
    return sendError(reply, request, 402, 'pro_plan_required', 'Автоматическая отправка доступна только на активном тарифе Pro.', false);
  }
  const now = new Date().toISOString();
  for (const key of consentKeys) deps.automationRepository.acceptConsent(candidateId, key, CONSENT_VERSION, CONSENT_TEXT[key], now);
  const current = deps.automationRepository.getSettings(candidateId);
  const settings = deps.automationRepository.saveSettings(candidateId, {
    enabled: true,
    mode: input.mode,
    rules: input.rules ?? current.rules ?? DEFAULT_CANDIDATE_AUTOMATION_RULES,
  }, now);
  const runtime = deps.automationRepository.schedulerRepository.getRuntime(candidateId);
  if (!runtime.emergencyPaused) {
    deps.automationRepository.schedulerRepository.setRuntime(candidateId, {
      nextSendAt: now, pauseUntil: null, status: 'ready', consecutiveErrors: 0, lastFailureCode: null,
    }, now);
  }
  return reply.send({ data: { settings, consents: deps.automationRepository.listConsents(candidateId), linkedinPublishing: stateResponse(deps, candidateId).linkedinPublishing } });
}

const disableAutomation: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const current = deps.automationRepository.getSettings(candidate.id);
  const settings = deps.automationRepository.saveSettings(candidate.id, { ...current, enabled: false });
  return reply.send({ data: { settings } });
};

const saveAutomationRules: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const parsed = rulesSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_automation_rules', 'Проверьте роли, совпадение и площадки.', false);
  const current = deps.automationRepository.getSettings(candidate.id);
  const settings = deps.automationRepository.saveSettings(candidate.id, { ...current, rules: parsed.data });
  return reply.send({ data: { settings } });
};

const revokeAutomationConsent: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const params = consentKeySchema.safeParse((request.params as { key: string }).key);
  if (!params.success) return sendError(reply, request, 400, 'invalid_consent_key', 'Неизвестное согласие.', false);
  const revoked = deps.automationRepository.revokeConsent(candidate.id, params.data);
  return reply.send({ data: { revoked, ...stateResponse(deps, candidate.id) } });
};

const pauseAutomation: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const parsed = pauseSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_pause_days', 'Пауза должна быть от 1 до 365 дней.', false);
  const until = new Date(Date.now() + parsed.data.days * 86_400_000).toISOString();
  deps.candidateActionRepository?.setKillSwitch(`candidate:${candidate.id}`, true, 'manual_pause');
  const settings = deps.automationRepository.setPause(candidate.id, until);
  const runtime = deps.automationRepository.schedulerRepository.setRuntime(candidate.id, {
    status: 'paused', pauseUntil: until, nextSendAt: until,
  });
  return reply.send({ data: { settings, runtime } });
};

const resumeAutomation: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const settings = deps.automationRepository.setPause(candidate.id, null);
  deps.candidateActionRepository?.setKillSwitch(`candidate:${candidate.id}`, false, 'manual_pause');
  const runtime = deps.automationRepository.schedulerRepository.setEmergencyPause(candidate.id, false);
  return reply.send({ data: { settings, runtime } });
};

function paused(settings: ReturnType<SqliteCandidateAutomationRepository['getSettings']>, now = new Date()): boolean {
  return Boolean(settings.pausedUntil && new Date(settings.pausedUntil).getTime() > now.getTime());
}

function requireAutomationEnabled(
  deps: AutomationDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
): ReturnType<SqliteCandidateAutomationRepository['getSettings']> | null {
  const settings = deps.automationRepository.getSettings(candidateId);
  if (!settings.enabled || !deps.automationRepository.hasActiveConsent(candidateId, 'drafts')) {
    sendError(reply, request, 403, 'automation_consent_required', 'Сначала включите режим и сохраните согласия.', false);
    return null;
  }
  if (paused(settings)) {
    sendError(reply, request, 409, 'automation_paused', 'Очередь на паузе. Снимите паузу, чтобы продолжить.', false);
    return null;
  }
  return settings;
}

function requireApprovalMode(
  deps: AutomationDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
): boolean {
  if (!deps.automationRepository.hasActiveConsent(candidateId, 'send_after_approval')) {
    sendError(reply, request, 403, 'send_consent_required', 'Для отправки нужно действующее согласие.', false);
    return false;
  }
  const settings = deps.automationRepository.getSettings(candidateId);
  if (settings.mode === 'drafts_only') {
    sendError(reply, request, 403, 'approval_mode_required', 'Выберите режим с одобрением перед отправкой.', false);
    return false;
  }
  return true;
}

const listAutomationQueue: Handler = async (deps, request, reply) => {
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const parsed = queueListSchema.safeParse(request.query);
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_queue_filter', 'Проверьте фильтр очереди.', false);
  const { status, platform, limit, offset } = parsed.data;
  const items = deps.automationRepository.listQueue(candidate.id, { status, platform, limit, offset });
  return reply.send({ data: { items: items.map(queueSummary), total: deps.automationRepository.countQueue(candidate.id, status, platform), limit, offset } });
};

function queueSummary(item: CandidateAutomationQueueItem) {
  return {
    id: item.id,
    candidateId: item.candidateId,
    applicationId: item.applicationId,
    status: item.status,
    displayStatus: displayQueueStatus(item),
    sendTiming: item.sendTiming,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    clusterId: item.payload.clusterId,
    platform: item.payload.platform,
    title: item.payload.title,
    role: item.payload.role,
    company: item.payload.company,
    requirements: item.payload.requirements,
    letterReady: item.payload.letterText.trim().length > 0,
    materialCount: item.payload.materials.length,
  };
}

function displayQueueStatus(item: CandidateAutomationQueueItem): string {
  if (item.status === 'letter_not_ready') return 'letter_not_ready';
  if (item.status === 'pending_approval') return item.sendTiming === 'today' ? 'will_send_today' : 'will_send_later';
  return item.status;
}

const previewQueueItem: Handler = async (deps, request, reply) => {
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const params = queueIdSchema.safeParse(request.params);
  if (!params.success) return sendError(reply, request, 400, 'invalid_queue_id', 'Некорректная запись очереди.', false);
  const item = deps.automationRepository.getQueueItem(candidate.id, params.data.id);
  if (!item) return sendError(reply, request, 404, 'automation_queue_item_not_found', 'Запись очереди не найдена.', false);
  return reply.send({ data: queuePreview(item) });
};

function queuePreview(item: CandidateAutomationQueueItem) {
  return {
    id: item.id,
    status: item.status,
    sendTiming: item.sendTiming,
    title: item.payload.title,
    company: item.payload.company,
    role: item.payload.role,
    platform: item.payload.platform,
    targetUrl: item.payload.targetUrl,
    requirements: item.payload.requirements,
    letterText: item.payload.letterText,
    materials: item.payload.materials,
  };
}

const refreshAutomationQueue: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const parsed = queueRefreshSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_queue_refresh', 'Проверьте список вакансий и материалы.', false);
  const settings = requireAutomationEnabled(deps, request, reply, candidate.id);
  if (!settings) return;
  if (settings.mode === 'automatic' && (!deps.automationRepository.hasActiveConsent(candidate.id, 'automatic_submission') || !hasActivePro(deps, request, candidate.id))) {
    return sendError(reply, request, 402, 'automatic_mode_unavailable', 'Автоматическая отправка требует согласия и активного тарифа Pro.', false);
  }
  return buildQueueFromCandidates(deps, request, reply, candidate, settings.rules, settings.mode, parsed.data.opportunities);
};

async function buildQueueFromCandidates(
  deps: AutomationDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidate: CandidateIdentity,
  rules: CandidateAutomationRules,
  mode: CandidateAutomationMode,
  opportunities: z.infer<typeof queueRefreshSchema>['opportunities'],
): Promise<unknown> {
  try {
    const snapshot = deps.candidateStore.getSnapshot(candidate.id);
    const stopped = deps.automationRepository.listStopCompanyKeys(candidate.id);
    const skills = (snapshot?.memory ?? []).filter(isConfirmedSkill).map((fact) => fact.statement);
    const schedule = createScheduleState(deps, request, candidate.id);
    const items: CandidateAutomationQueueItem[] = [];
    let skipped = 0;
    for (const input of opportunities) {
      const result = await buildQueueItem(deps, request, candidate.id, snapshot, input, rules, stopped, skills, schedule, mode);
      if (result.item) items.push(result.item); else skipped += 1;
    }
    return reply.send({ data: { added: items.length, skipped, items: items.map(queueSummary) } });
  } catch (error) {
    request.log.error({ event: 'automation-queue-build-failed', candidateId: candidate.id, failureType: failureType(error) }, 'candidate-automation-queue');
    return sendError(reply, request, 500, 'automation_queue_failed', 'Не удалось обновить очередь. Попробуйте позже.', true);
  }
}

function failureType(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function isConfirmedSkill(fact: CandidateSnapshot['memory'][number]): boolean {
  return fact.kind === 'fact' && (fact.domain === 'skill' || fact.confidence === 'candidate-confirmed');
}

async function buildQueueItem(
  deps: AutomationDeps,
  request: FastifyRequest,
  candidateId: string,
  snapshot: CandidateSnapshot,
  input: z.infer<typeof queueRefreshSchema>['opportunities'][number],
  rules: CandidateAutomationRules,
  stopped: ReadonlySet<string>,
  skills: string[],
  schedule: ScheduleState,
  mode: CandidateAutomationMode,
): Promise<{ item: CandidateAutomationQueueItem | null }> {
  if (deps.automationRepository.getQueueItemByCluster(candidateId, input.clusterId)) return { item: null };
  if (deps.automationRepository.countOpenQueue(candidateId) >= MAX_OPEN_CANDIDATE_AUTOMATION_ITEMS) return { item: null };
  const cluster = deps.multiSourceEngine.getActiveCluster(input.clusterId);
  if (!cluster) return { item: null };
  const platform = platformForTarget(cluster.primaryUrl);
  if (!platform) return { item: null };
  const explanation = matchCandidateWithVacancy({ candidateId, targetRoles: [...rules.roles], confirmedSkills: skills, confirmedFacts: skills }, cluster);
  const match: CandidateAutomationOpportunity = { roleMatch: explanation.roleMatch, requirements: explanation.requirements, platform, company: cluster.canonicalCompany };
  if (!matchesCandidateAutomationRules(match, rules, stopped)) return { item: null };
  const materials = resolveMaterials(snapshot, input.materialDocumentIds);
  if (!materials) return { item: null };
  if (!canCreateQueueItem(deps, request, candidateId, mode)) return { item: null };
  const applicationId = ensureSavedApplication(deps, request, candidateId, input.applicationId, cluster, platform);
  if (!applicationId) return { item: null };
  const timing = reserveSendTiming(schedule, platform);
  const payload = {
    clusterId: cluster.id,
    applicationId,
    platform,
    title: cluster.canonicalTitle,
    role: cluster.canonicalTitle,
    company: cluster.canonicalCompany,
    targetUrl: cluster.primaryUrl,
    requirements: explanation.requirements!,
    letterText: input.letterText?.trim() ?? '',
    materials,
  };
  const item = deps.automationRepository.addQueueItem(candidateId, payload, timing, mode === 'automatic');
  request.log.info({ event: 'automation-queue-item-created', platform, status: item.status }, 'candidate-automation-queue');
  return { item };
}

function canCreateQueueItem(
  deps: AutomationDeps,
  request: FastifyRequest,
  candidateId: string,
  requestedMode: CandidateAutomationMode,
): boolean {
  const settings = deps.automationRepository.getSettings(candidateId);
  if (!settings.enabled || settings.mode !== requestedMode) return false;
  if (!deps.automationRepository.hasActiveConsent(candidateId, 'drafts')) return false;
  if (!deps.automationRepository.hasActiveConsent(candidateId, 'send_after_approval')) return false;
  return requestedMode !== 'automatic' || (
    deps.automationRepository.hasActiveConsent(candidateId, 'automatic_submission') &&
    hasActivePro(deps, request, candidateId)
  );
}

interface ScheduleState {
  readonly timezone: string;
  readonly now: Date;
  readonly paused: boolean;
  readonly usedToday: Record<CandidateAutomationPlatform, number>;
  readonly reservedToday: Record<CandidateAutomationPlatform, number>;
}

function createScheduleState(deps: AutomationDeps, request: FastifyRequest, candidateId: string): ScheduleState {
  const timezone = accountTimezone(deps, request, candidateId);
  const now = new Date();
  const usage = deps.candidateActionRepository?.getDailyUsage(candidateId, formatLocalDate(now, timezone));
  const settings = deps.automationRepository.getSettings(candidateId);
  const existing = deps.automationRepository.listQueue(candidateId, { limit: 500 });
  const reserved = existing.filter((item) => item.sendTiming === 'today' && ['pending_approval', 'approved'].includes(item.status));
  return {
    timezone,
    now,
    paused: paused(settings, now),
    usedToday: {
      hh: usage?.hhAppliesCount ?? 0,
      linkedin: usage?.linkedinEasyAppliesCount ?? 0,
    },
    reservedToday: {
      hh: reserved.filter((item) => item.payload.platform === 'hh').length,
      linkedin: reserved.filter((item) => item.payload.platform === 'linkedin').length,
    },
  };
}

function reserveSendTiming(schedule: ScheduleState, platform: CandidateAutomationPlatform): 'today' | 'later' {
  const limit = platform === 'hh'
    ? DEFAULT_CANDIDATE_ACTION_LIMITS.maxHhAppliesPerDay
    : DEFAULT_CANDIDATE_ACTION_LIMITS.maxLinkedinEasyAppliesPerDay;
  const hasCapacity = schedule.usedToday[platform] + schedule.reservedToday[platform] < limit;
  if (!schedule.paused && !isWithinQuietHours(schedule.now, schedule.timezone) && hasCapacity) {
    schedule.reservedToday[platform] += 1;
    return 'today';
  }
  return 'later';
}

function platformForTarget(url: string): CandidateAutomationPlatform | null {
  if (isAllowedCandidateActionTarget('hh', url)) return 'hh';
  if (isAllowedCandidateActionTarget('linkedin', url)) return 'linkedin';
  return null;
}

function resolveMaterials(snapshot: CandidateSnapshot, ids: readonly string[]) {
  const documents = ids.map((id) => snapshot.documents.find((document) => document.id === id));
  if (documents.some((document) => !document || document.kind !== 'resume')) return null;
  return documents.map((document) => ({
    documentId: document!.id,
    kind: 'resume' as const,
    fileName: document!.fileName,
    version: document!.version,
  }));
}

function ensureSavedApplication(
  deps: AutomationDeps,
  request: FastifyRequest,
  candidateId: string,
  applicationId: string | undefined,
  cluster: VacancyCluster,
  platform: CandidateAutomationPlatform,
): string | null {
  if (applicationId) {
    const existing = deps.candidateStore.getApplication(candidateId, applicationId);
    return existing?.clusterId === cluster.id && existing.stage === 'saved' ? existing.id : null;
  }
  try {
    const application = deps.candidateStore.createApplication(candidateId, {
      clusterId: cluster.id,
      stage: 'saved',
      manualVacancy: {
        title: cluster.canonicalTitle,
        company: cluster.canonicalCompany,
        url: cluster.primaryUrl,
        source: platform === 'hh' ? 'hh.ru' : 'LinkedIn',
      },
    });
    return application.id;
  } catch (error) {
    request.log.warn({ event: 'automation-application-create-failed', candidateId, failureType: failureType(error) }, 'candidate-automation-queue');
    return null;
  }
}

const createStopCompany: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const parsed = companySchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_company_name', 'Укажите название компании.', false);
  const added = deps.automationRepository.addStopCompany(candidate.id, parsed.data.company, 'manual');
  removeQueueForCompany(deps, candidate.id, parsed.data.company);
  return reply.send({ data: { added, stopCompanies: deps.automationRepository.listStopCompanies(candidate.id) } });
};

function removeQueueForCompany(deps: AutomationDeps, candidateId: string, company: string): void {
  const key = companyStopKey(company);
  if (!key) return;
  const items = OPEN_QUEUE_STATUSES.flatMap((status) =>
    deps.automationRepository.listQueue(candidateId, { status, limit: MAX_OPEN_CANDIDATE_AUTOMATION_ITEMS }),
  );
  for (const item of items) {
    if (companyStopKey(item.payload.company) === key && ['letter_not_ready', 'pending_approval', 'approved'].includes(item.status)) {
      deps.automationRepository.transitionQueueItem(candidateId, item.id, 'remove');
    }
  }
}

const removeStopCompany: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const parsed = companySchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_company_name', 'Укажите название компании.', false);
  const removed = deps.automationRepository.removeStopCompany(candidate.id, parsed.data.company);
  return reply.send({ data: { removed, stopCompanies: deps.automationRepository.listStopCompanies(candidate.id) } });
};

const importRejectedCompanies: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const parsed = importRejectedSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_rejection_import', 'Передайте до 100 своих карточек с отказом.', false);
  const known = new Set(deps.automationRepository.listStopCompanies(candidate.id).map((item) => companyStopKey(item.company)).filter((key): key is string => Boolean(key)));
  let imported = 0;
  for (const id of parsed.data.applicationIds) {
    const application = deps.candidateStore.getApplication(candidate.id, id);
    const company = application?.stage === 'rejected' ? application.vacancy?.company : undefined;
    const key = company ? companyStopKey(company) : null;
    if (key && !known.has(key) && deps.automationRepository.addStopCompany(candidate.id, company!, 'rejection')) {
      known.add(key);
      imported += 1;
    }
  }
  return reply.send({ data: { imported, stopCompanies: deps.automationRepository.listStopCompanies(candidate.id) } });
};

const editQueueLetter: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const params = queueIdSchema.safeParse(request.params);
  const body = z.object({ letterText: z.string().max(5_000) }).strict().safeParse(request.body);
  if (!params.success || !body.success) return sendError(reply, request, 400, 'invalid_queue_letter', 'Проверьте текст письма.', false);
  const item = deps.automationRepository.updateQueueLetter(candidate.id, params.data.id, body.data.letterText);
  if (!item) return sendError(reply, request, 409, 'automation_letter_locked', 'Это письмо уже нельзя изменить из очереди.', false);
  return reply.send({ data: { item: queueSummary(item) } });
};

const queueItemAction: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const params = queueIdSchema.safeParse(request.params);
  const body = actionSchema.safeParse(request.body);
  if (!params.success || !body.success) return sendError(reply, request, 400, 'invalid_queue_action', 'Проверьте действие очереди.', false);
  const item = deps.automationRepository.getQueueItem(candidate.id, params.data.id);
  if (!item) return sendError(reply, request, 404, 'automation_queue_item_not_found', 'Запись очереди не найдена.', false);
  if (body.data.action === 'approve_and_send' && !canApprove(deps, request, reply, candidate.id)) return;
  const action = queueAction(body.data.action);
  try {
    transitionCandidateAutomationQueue(item.status, action, item.payload.letterText.trim().length > 0);
  } catch (error) {
    return transitionError(deps, request, reply, error);
  }
  if (body.data.action === 'stop_company') {
    deps.automationRepository.addStopCompany(candidate.id, item.payload.company, 'manual');
    removeQueueForCompany(deps, candidate.id, item.payload.company);
    const stoppedItem = deps.automationRepository.getQueueItem(candidate.id, item.id);
    return reply.send({ data: { item: stoppedItem ? queueSummary(stoppedItem) : null, execution: 'not_started' } });
  }
  const updated = deps.automationRepository.transitionQueueItem(candidate.id, item.id, action);
  if (!updated) return sendError(reply, request, 409, 'automation_queue_conflict', 'Запись очереди уже изменилась.', false);
  return reply.send({ data: { item: queueSummary(updated), execution: updated.status === 'approved' ? 'scheduled' : 'not_started' } });
};

function canApprove(deps: AutomationDeps, request: FastifyRequest, reply: FastifyReply, candidateId: string): boolean {
  const settings = requireAutomationEnabled(deps, request, reply, candidateId);
  return Boolean(settings && requireApprovalMode(deps, request, reply, candidateId));
}

function queueAction(action: z.infer<typeof actionSchema>['action']): CandidateAutomationQueueAction {
  if (action === 'approve_and_send') return 'approve';
  if (action === 'stop_company' || action === 'remove') return 'remove';
  return 'consultant';
}

function transitionError(deps: AutomationDeps, request: FastifyRequest, reply: FastifyReply, error: unknown) {
  const code = error instanceof Error ? error.message : 'automation_transition_not_allowed';
  const message = code === 'automation_letter_not_ready'
    ? 'Сначала подготовьте письмо.'
    : 'Для этой записи действие недоступно.';
  return sendError(reply, request, 409, code, message, false);
}

const bulkQueueAction: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  const parsed = bulkSchema.safeParse(request.body);
  if (!parsed.success) return sendError(reply, request, 400, 'invalid_queue_bulk_action', 'Проверьте фильтр и массовое действие.', false);
  return applyBulkAction(deps, request, reply, candidate.id, parsed.data);
};

function applyBulkAction(
  deps: AutomationDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  candidateId: string,
  input: z.infer<typeof bulkSchema>,
) {
  if (input.action === 'approve_and_send' && !canApprove(deps, request, reply, candidateId)) return;
  const count = deps.automationRepository.countQueue(candidateId, input.filter.status, input.filter.platform);
  if (count > 500) return sendError(reply, request, 413, 'automation_bulk_limit', 'Сузьте фильтр очереди до 500 записей.', false);
  const items = deps.automationRepository.listQueue(candidateId, { ...input.filter, limit: 500 });
  const action = queueAction(input.action);
  try {
    for (const item of items) transitionCandidateAutomationQueue(item.status, action, item.payload.letterText.trim().length > 0);
  } catch (error) {
    return transitionError(deps, request, reply, error);
  }
  return reply.send({ data: { matched: items.length, updated: applyBulkTransitions(deps, candidateId, items, input.action, action) } });
}

function applyBulkTransitions(
  deps: AutomationDeps,
  candidateId: string,
  items: readonly CandidateAutomationQueueItem[],
  requested: z.infer<typeof bulkSchema>['action'],
  action: CandidateAutomationQueueAction,
): number {
  if (requested === 'stop_company') return stopCompaniesForQueueItems(deps, candidateId, items);
  let updated = 0;
  for (const item of items) {
    if (deps.automationRepository.transitionQueueItem(candidateId, item.id, action)) updated += 1;
  }
  return updated;
}

function stopCompaniesForQueueItems(
  deps: AutomationDeps,
  candidateId: string,
  items: readonly CandidateAutomationQueueItem[],
): number {
  const companies = new Map<string, string>();
  for (const item of items) {
    const key = companyStopKey(item.payload.company);
    if (key) companies.set(key, item.payload.company);
  }
  for (const company of companies.values()) {
    deps.automationRepository.addStopCompany(candidateId, company, 'manual');
    removeQueueForCompany(deps, candidateId, company);
  }
  return items.filter((item) => deps.automationRepository.getQueueItem(candidateId, item.id)?.status === 'removed').length;
}

export function registerCandidateAutomationRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const provided = (deps as RouteDeps & { candidateAutomationRepository?: SqliteCandidateAutomationRepository }).candidateAutomationRepository;
  const automationRepository = provided ?? new SqliteCandidateAutomationRepository({
    databasePath: deps.config.databasePath,
    encryptionKey: deps.config.dataEncryptionKey,
  });
  const bound = { ...deps, automationRepository } as AutomationDeps;
  if (!provided) app.addHook('onClose', async () => automationRepository.close());
  app.get('/api/v1/candidate/automation', withDeps(bound, getAutomationState));
  app.post('/api/v1/candidate/automation/enable', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, withDeps(bound, enableAutomation));
  app.post('/api/v1/candidate/automation/disable', withDeps(bound, disableAutomation));
  app.put('/api/v1/candidate/automation/rules', withDeps(bound, saveAutomationRules));
  app.post('/api/v1/candidate/automation/consents/:key/revoke', withDeps(bound, revokeAutomationConsent));
  app.post('/api/v1/candidate/automation/pause', withDeps(bound, pauseAutomation));
  app.delete('/api/v1/candidate/automation/pause', withDeps(bound, resumeAutomation));
  app.get('/api/v1/candidate/automation/queue', withDeps(bound, listAutomationQueue));
  app.post('/api/v1/candidate/automation/queue/refresh', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, withDeps(bound, refreshAutomationQueue));
  app.get('/api/v1/candidate/automation/queue/:id/preview', withDeps(bound, previewQueueItem));
  app.patch('/api/v1/candidate/automation/queue/:id/letter', withDeps(bound, editQueueLetter));
  app.post('/api/v1/candidate/automation/queue/:id/actions', withDeps(bound, queueItemAction));
  app.post('/api/v1/candidate/automation/queue/bulk', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, withDeps(bound, bulkQueueAction));
  app.get('/api/v1/candidate/automation/stop-companies', withDeps(bound, getStopCompanies));
  app.post('/api/v1/candidate/automation/stop-companies', withDeps(bound, createStopCompany));
  app.delete('/api/v1/candidate/automation/stop-companies', withDeps(bound, removeStopCompany));
  app.post('/api/v1/candidate/automation/stop-companies/import-rejections', { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } }, withDeps(bound, importRejectedCompanies));
  registerCandidateAutomationScheduleRoutes(app, bound);
}

const getStopCompanies: Handler = async (deps, request, reply) => {
  const candidate = authenticate(deps, request, reply);
  if (!candidate) return;
  return reply.send({ data: { stopCompanies: deps.automationRepository.listStopCompanies(candidate.id) } });
};
