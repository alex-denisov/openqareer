import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { registerRoleSkillAssessmentCaseRoutes } from './roleSkillAssessmentCaseRoutes';
import { generateProfileSuggestions } from './roleSkillAssessmentSuggestions';
import { z } from 'zod';
import { MIN_ROLE_SAMPLE, titleKey } from '../../shared/poolRoleHypotheses';
import { canonicalizeSkill } from '../connectors/managementSkillsDictionary';
import {
  isRoleSkillAssessmentStale,
  buildRoleSkillCases,
  buildRoleSkillRequirementSummaries,
  countFreshActiveRoleVacancies,
  type RoleAssessmentVacancy,
  type RoleSkillAssessmentRun,
} from '../domain/roleSkillAssessment';
import type { ResumeEvidenceImport } from '../data/candidateStore';
import type { CandidateIdentity } from '../data/candidateStore';
import { MAX_VACANCY_AGE_DAYS } from '../vacancies/vacancyPoolQuery';
import { readMatchProfile, readMatchedSnapshot } from '../vacancies/matchedPoolContext';
import { readTargetLevel } from './vacancyRoleContext';
import type { RouteDeps } from './deps';
import {
  actionSchema,
  checkReplay,
  conflict,
  requestBase,
  requestDigest,
  requireMutationCandidate,
  singleFlight,
} from './roleSkillAssessmentRouteSupport';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

const roleSchema = z.string().trim().min(1).max(200);
const startSchema = z.object({ consent: z.literal(true), role: roleSchema.optional() }).strict();
const currentQuerySchema = z.object({ role: roleSchema.optional() });

/** Роль проверки: нажатая на «Карьере» или, без неё, роль «Стратегии» (B445). */
interface AssessedRole {
  readonly title: string;
  readonly version: number;
  readonly fromStrategy: boolean;
}

function sameRoleTitle(left: string, right: string): boolean {
  return titleKey(left) === titleKey(right);
}

function resolveAssessedRole(
  deps: RouteDeps,
  candidateId: string,
  requested: string | undefined,
): AssessedRole | null {
  const strategy = deps.candidateStore.getCareerStrategy(candidateId);
  const strategyRole = strategy
    ? { title: strategy.current.role.title, version: strategy.current.version, fromStrategy: true }
    : null;
  if (!requested) return strategyRole;
  if (strategyRole && sameRoleTitle(strategyRole.title, requested)) return strategyRole;
  // Роль не из «Стратегии»: выбор «Стратегии» не меняется, у роли своя первая версия.
  return { title: requested, version: 1, fromStrategy: false };
}

function latestRunFor(deps: RouteDeps, candidateId: string, role: AssessedRole | null) {
  const runs = deps.candidateStore.roleSkillAssessments.list(candidateId);
  if (!role) return runs[0];
  // Прогон ищется по названию роли: проверка роли с «Карьеры» не перекрывает роль
  // «Стратегии», а смена роли «Стратегии» открывает свежую проверку новой роли.
  return runs.find((run) => sameRoleTitle(run.roleTitle, role.title));
}
const dialogueSchema = requestBase.extend({ answer: z.string().trim().min(1).max(8_000) }).strict();
const suggestionDecisionSchema = requestBase
  .extend({
    suggestions: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            accepted: z.boolean(),
            statement: z.string().trim().max(1_000),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();

const DIALOGUE_QUESTIONS = [
  'Какую часть работы в этой роли вы брали на себя?',
  'Какой результат вашей работы можно подтвердить наблюдаемым фактом или показателем?',
  'Какие ограничения, команда или решение повлияли на этот результат?',
] as const;

type AssessmentContext =
  | { readonly state: 'role_not_selected' }
  | { readonly state: 'source_unavailable' }
  | {
      readonly state: 'too_few_vacancies';
      readonly roleTitle: string;
      readonly sampleSize: number;
      readonly threshold: number;
    }
  | {
      readonly state: 'insufficient_requirements';
      readonly roleTitle: string;
      readonly sampleSize: number;
      readonly requirementCount: number;
    }
  | {
      readonly state: 'ready';
      readonly roleTitle: string;
      readonly roleVersion: number;
      readonly sampleSize: number;
      readonly evidenceObservedAt: string;
      readonly skills: ReturnType<typeof buildRoleSkillRequirementSummaries>;
      readonly cases: ReturnType<typeof buildRoleSkillCases>;
    };

type MatchedRoleSnapshot =
  | { readonly state: 'source_unavailable' }
  | {
      readonly state: 'matched';
      readonly vacancies: Awaited<ReturnType<typeof readMatchedSnapshot>>;
    };

const activeStarts = new WeakMap<RouteDeps, Map<string, Promise<unknown>>>();

export function registerRoleSkillAssessmentRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.get(
    '/api/v1/candidate/role-skill-assessments/current',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    withDeps(deps, handleCurrent),
  );
  app.get(
    '/api/v1/candidate/role-skill-assessments/checked-roles',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    withDeps(deps, handleCheckedRoles),
  );
  app.post(
    '/api/v1/candidate/role-skill-assessments/start',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    withDeps(deps, handleStart),
  );
  app.post(
    '/api/v1/candidate/role-skill-assessments/:runId/dialogue',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    withDeps(deps, handleDialogue),
  );
  app.post(
    '/api/v1/candidate/role-skill-assessments/:runId/suggestions',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    withDeps(deps, handleSuggestions),
  );
  app.post(
    '/api/v1/candidate/role-skill-assessments/:runId/suggestions/rollback',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    withDeps(deps, handleSuggestionRollback),
  );
  registerRoleSkillAssessmentCaseRoutes(app, deps);
}

async function handleCurrent(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const { role: requested } = currentQuerySchema.parse(request.query ?? {});
  const role = resolveAssessedRole(deps, candidate.id, requested);
  const latest = latestRunFor(deps, candidate.id, role);
  if (latest) {
    if (!role) return reply.send({ data: { state: 'role_changed', run: latest } });
    if (latest.roleVersion !== role.version || latest.roleTitle !== role.title) {
      return reply.send({ data: { state: 'role_changed', run: latest } });
    }
    if (latest.status !== 'complete') return reply.send({ data: { state: 'run', run: latest } });
    const stale = Boolean(
      latest.completedAt &&
      isRoleSkillAssessmentStale(latest.completedAt, new Date().toISOString()),
    );
    return reply.send({ data: { state: 'result', run: latest, stale } });
  }

  const context = await readAssessmentContext(deps, candidate.id, role);
  return reply.send({ data: context });
}

/** Роли с завершённой проверкой: «Карьера» ставит им статус «Навыки проверены» (B445). */
async function handleCheckedRoles(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const seen = new Set<string>();
  const checked = deps.candidateStore.roleSkillAssessments
    .list(candidate.id)
    .filter((run) => run.status === 'complete' && run.completedAt)
    .filter((run) => {
      const key = titleKey(run.roleTitle);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((run) => ({ roleTitle: run.roleTitle, completedAt: run.completedAt }));
  return reply.send({ data: checked });
}

async function handleStart(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const { role: requested } = startSchema.parse(request.body);
  const starts = activeStarts.get(deps) ?? new Map<string, Promise<unknown>>();
  activeStarts.set(deps, starts);
  const pending = starts.get(candidate.id);
  if (pending) return pending;
  const operation = startRun(deps, candidate, reply, requested).finally(() =>
    starts.delete(candidate.id),
  );
  starts.set(candidate.id, operation);
  return operation;
}

async function startRun(
  deps: RouteDeps,
  candidate: NonNullable<ReturnType<typeof authenticateCandidate>>,
  reply: FastifyReply,
  requested?: string,
) {
  const role = resolveAssessedRole(deps, candidate.id, requested);
  if (!role) return reply.send({ data: { state: 'role_not_selected' } });
  const latest = latestRunFor(deps, candidate.id, role);
  if (
    latest &&
    latest.roleVersion === role.version &&
    latest.roleTitle === role.title &&
    latest.status !== 'complete'
  ) {
    return reply.send({ data: { state: 'run', run: latest } });
  }

  const context = await readAssessmentContext(deps, candidate.id, role);
  if (context.state !== 'ready') return reply.send({ data: context });
  const run = createInitialAssessmentRun(context);
  deps.candidateStore.roleSkillAssessments.create(candidate.id, run);
  return reply.send({ data: { state: 'run', run } });
}

function createInitialAssessmentRun(
  context: Extract<AssessmentContext, { state: 'ready' }>,
): RoleSkillAssessmentRun {
  const now = new Date().toISOString();
  const cases = createPendingAssessmentCases(context);
  return {
    id: randomUUID(),
    revision: 1,
    roleTitle: context.roleTitle,
    roleVersion: context.roleVersion,
    status: 'dialogue',
    consentedAt: now,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    sampleSize: context.sampleSize,
    evidenceObservedAt: context.evidenceObservedAt,
    dialogueQuestions: [...DIALOGUE_QUESTIONS],
    dialogueEntries: [],
    currentDialogueIndex: 0,
    suggestions: [],
    profileChange: { memoryIds: [], acceptedAt: null, revertedAt: null },
    cases,
    skills: createInitialAssessmentSkills(context, cases),
    currentCaseIndex: 0,
    readiness: {
      ready: false,
      confirmedCount: 0,
      missingKeySkillIds: context.skills
        .filter((skill) => skill.isKeySkill)
        .map((skill) => skill.skillId),
    },
    modelError: null,
    lastRequest: null,
  };
}

function createPendingAssessmentCases(context: Extract<AssessmentContext, { state: 'ready' }>) {
  return context.cases.map((assessmentCase) => ({
    assessmentCase: { ...assessmentCase, sourceRefs: [...assessmentCase.sourceRefs] },
    status: 'pending' as const,
    answer: null,
    evaluation: null,
    evaluationHistory: [],
    appealReason: null,
    pendingDiscussionQuestion: null,
    discussion: [],
  }));
}

function createInitialAssessmentSkills(
  context: Extract<AssessmentContext, { state: 'ready' }>,
  cases: ReturnType<typeof createPendingAssessmentCases>,
) {
  const caseIdsBySkill = new Map(
    cases.map((record) => [record.assessmentCase.skillId, record.assessmentCase.id]),
  );
  return context.skills.map((skill) => ({
    id: skill.skillId,
    name: skill.name,
    isKeySkill: skill.isKeySkill,
    grade: 'not_confirmed' as const,
    explanation: 'Навык ещё не проверен.',
    caseId: caseIdsBySkill.get(skill.skillId) ?? null,
    sourceRefs: [...skill.sourceRefs],
  }));
}

async function readAssessmentContext(
  deps: RouteDeps,
  candidateId: string,
  role: AssessedRole | null,
): Promise<AssessmentContext> {
  if (!role) return { state: 'role_not_selected' };
  const snapshot = await readRoleSnapshot(deps, candidateId, role.title);
  if (snapshot.state !== 'matched') return snapshot;
  return summarizeAssessmentContext(role.title, role.version, snapshot.vacancies);
}

async function readRoleSnapshot(
  deps: RouteDeps,
  candidateId: string,
  roleTitle: string,
): Promise<MatchedRoleSnapshot> {
  const targetRoles = [roleTitle];
  const { confirmedSkills } = readMatchProfile(deps.candidateStore, candidateId);
  const targetLevel = readTargetLevel(deps.candidateStore, candidateId, targetRoles);
  try {
    const vacancies = await readMatchedSnapshot(
      deps.multiSourceEngine,
      candidateId,
      confirmedSkills,
      targetRoles,
      targetLevel,
    );
    return { state: 'matched', vacancies };
  } catch {
    return { state: 'source_unavailable' };
  }
}

function summarizeAssessmentContext(
  roleTitle: string,
  roleVersion: number,
  matched: Awaited<ReturnType<typeof readMatchedSnapshot>>,
): AssessmentContext {
  const roleId = titleKey(roleTitle);
  const vacancies = toAssessmentVacancies(matched, roleId, new Date());
  const sampleSize = countFreshActiveRoleVacancies(vacancies, roleId);
  if (sampleSize < MIN_ROLE_SAMPLE) {
    return { state: 'too_few_vacancies', roleTitle, sampleSize, threshold: MIN_ROLE_SAMPLE };
  }
  const skills = buildRoleSkillRequirementSummaries(vacancies, roleId);
  const cases = buildRoleSkillCases(vacancies, roleId);
  if (skills.length < 5 || cases.length < 3) {
    return {
      state: 'insufficient_requirements',
      roleTitle,
      sampleSize,
      requirementCount: skills.length,
    };
  }
  const dates = cases.flatMap((assessmentCase) =>
    assessmentCase.sourceRefs.map((source) => source.observedAt),
  );
  const evidenceObservedAt = [...dates].sort().at(-1) ?? new Date().toISOString();
  return {
    state: 'ready',
    roleTitle,
    roleVersion,
    sampleSize,
    evidenceObservedAt,
    skills,
    cases,
  };
}

function toAssessmentVacancies(
  matched: Awaited<ReturnType<typeof readMatchedSnapshot>>,
  roleId: string,
  now: Date,
): RoleAssessmentVacancy[] {
  const cutoff = now.getTime() - MAX_VACANCY_AGE_DAYS * 24 * 60 * 60 * 1_000;
  return matched.flatMap(({ cluster, explanation }) => {
    if (cluster.status !== 'active' || explanation.roleMatch !== 'target') return [];
    const sourceRefs = cluster.sources.flatMap((source) => {
      const observedAtMs = Date.parse(source.observedAt);
      if (!Number.isFinite(observedAtMs) || observedAtMs < cutoff || observedAtMs > now.getTime())
        return [];
      return [
        {
          sourceId: source.sourceId,
          observedAt: source.observedAt,
          sourceName: source.sourceName ?? 'Источник вакансии',
        },
      ];
    });
    const freshness = sourceRefs.length > 0 ? ('fresh' as const) : ('stale' as const);
    const requirements = cluster.skills.map((label) => {
      const normalizedSkill = canonicalizeSkill(label).trim();
      const skillId = normalizeSkillId(normalizedSkill);
      return {
        id: `requirement-${stableRefId(cluster.id, skillId)}`,
        skillId,
        statement: label.trim(),
        sourceRefs: sourceRefs.map((source) => ({
          id: stableRefId(cluster.id, `${source.sourceId}:${skillId}`),
          vacancyId: cluster.id,
          observedAt: source.observedAt,
          sourceName: source.sourceName,
        })),
      };
    });
    return [{ id: cluster.id, roleId, status: 'active' as const, freshness, requirements }];
  });
}

function normalizeSkillId(value: string): string {
  return (
    value
      .toLocaleLowerCase('ru-RU')
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/gu, '')
      .slice(0, 70) || 'skill'
  );
}

function stableRefId(left: string, right: string): string {
  return createHash('sha256').update(`${left}\u0000${right}`).digest('hex').slice(0, 32);
}

async function handleDialogue(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = await requireMutationCandidate(deps, request, reply);
  if (!candidate) return undefined;
  const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);
  const body = dialogueSchema.parse(request.body);
  const run = deps.candidateStore.roleSkillAssessments.get(candidate.id, runId);
  if (!run)
    return sendError(reply, request, 404, 'assessment_not_found', 'Проверка не найдена.', false);
  const digest = requestDigest('dialogue', runId, body);
  const replay = checkReplay(run, body.requestId, digest, request, reply);
  if (replay !== undefined) return replay;
  if (run.revision !== body.expectedRevision || run.status !== 'dialogue') {
    return conflict(reply, request);
  }

  return singleFlight(
    deps,
    `${candidate.id}:${runId}`,
    digest,
    () => advanceDialogue(deps, candidate, run, body, digest, reply, request),
    () => conflict(reply, request),
  );
}

async function advanceDialogue(
  deps: RouteDeps,
  candidate: CandidateIdentity,
  run: RoleSkillAssessmentRun,
  body: z.infer<typeof dialogueSchema>,
  digest: string,
  reply: FastifyReply,
  request: FastifyRequest,
) {
  const entry = {
    id: randomUUID(),
    question: run.dialogueQuestions[run.currentDialogueIndex],
    answer: body.answer,
    answeredAt: new Date().toISOString(),
  };
  const pending: RoleSkillAssessmentRun = {
    ...run,
    revision: run.revision + 1,
    updatedAt: entry.answeredAt,
    dialogueEntries: [...run.dialogueEntries, entry],
    currentDialogueIndex: run.currentDialogueIndex + 1,
    lastRequest: { id: body.requestId, digest },
  };
  if (pending.dialogueEntries.length < 3) {
    return saveDialogueProgress(deps, candidate.id, pending, run.revision, reply, request);
  }
  return generateProfileSuggestions(
    deps,
    candidate,
    pending,
    body.expectedRevision,
    reply,
    request,
  );
}

function saveDialogueProgress(
  deps: RouteDeps,
  candidateId: string,
  run: RoleSkillAssessmentRun,
  expectedRevision: number,
  reply: FastifyReply,
  request: FastifyRequest,
) {
  if (!deps.candidateStore.roleSkillAssessments.update(candidateId, run, expectedRevision)) {
    return conflict(reply, request);
  }
  return reply.send({ data: { state: 'run', run } });
}

async function handleSuggestions(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = await requireMutationCandidate(deps, request, reply);
  if (!candidate) return undefined;
  const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);
  const body = suggestionDecisionSchema.parse(request.body);
  const run = deps.candidateStore.roleSkillAssessments.get(candidate.id, runId);
  if (!run)
    return sendError(reply, request, 404, 'assessment_not_found', 'Проверка не найдена.', false);
  const digest = requestDigest('suggestions', runId, body);
  const replay = checkReplay(run, body.requestId, digest, request, reply);
  if (replay !== undefined) return replay;
  if (run.revision !== body.expectedRevision || run.status !== 'suggestions')
    return conflict(reply, request);
  if (!hasMatchingSuggestionIds(run, body.suggestions)) {
    return sendError(
      reply,
      request,
      400,
      'suggestions_mismatch',
      'Список предложений изменился. Обновите экран.',
      false,
    );
  }
  const updates = buildSuggestionUpdates(run, body.suggestions);
  const accepted = updates.filter((item) => item.accepted);
  const updatedRun = buildSuggestionDecisionRun(run, updates, body.requestId, digest);
  return singleFlight(
    deps,
    `${candidate.id}:${runId}`,
    digest,
    () => saveSuggestionDecisions(deps, candidate, run, updatedRun, accepted, reply, request),
    () => conflict(reply, request),
  );
}

function hasMatchingSuggestionIds(
  run: RoleSkillAssessmentRun,
  decisions: z.infer<typeof suggestionDecisionSchema>['suggestions'],
): boolean {
  const ids = new Set(run.suggestions.map((item) => item.id));
  return (
    decisions.length === ids.size &&
    new Set(decisions.map((item) => item.id)).size === ids.size &&
    decisions.every((item) => ids.has(item.id))
  );
}

function buildSuggestionUpdates(
  run: RoleSkillAssessmentRun,
  decisions: z.infer<typeof suggestionDecisionSchema>['suggestions'],
) {
  const originalById = new Map(run.suggestions.map((suggestion) => [suggestion.id, suggestion]));
  return decisions.map((decision) => ({
    original: originalById.get(decision.id)!,
    accepted: decision.accepted,
    statement: decision.statement.trim() || originalById.get(decision.id)!.statement,
  }));
}

function buildSuggestionDecisionRun(
  run: RoleSkillAssessmentRun,
  updates: ReturnType<typeof buildSuggestionUpdates>,
  requestId: string,
  digest: string,
): RoleSkillAssessmentRun {
  return {
    ...run,
    revision: run.revision + 1,
    updatedAt: new Date().toISOString(),
    status: 'cases',
    profileChange: run.profileChange ?? { memoryIds: [], acceptedAt: null, revertedAt: null },
    suggestions: updates.map(({ original, accepted: selected, statement }) => ({
      ...original,
      statement,
      selected,
      accepted: selected,
    })),
    lastRequest: { id: requestId, digest },
  };
}

async function saveSuggestionDecisions(
  deps: RouteDeps,
  candidate: CandidateIdentity,
  previous: RoleSkillAssessmentRun,
  updated: RoleSkillAssessmentRun,
  accepted: ReturnType<typeof buildSuggestionUpdates>,
  reply: FastifyReply,
  request: FastifyRequest,
) {
  let persistedRun = updated;
  try {
    deps.candidateStore.transaction(() => {
      const memoryIds = importAcceptedSuggestions(deps, candidate.id, previous, accepted);
      if (memoryIds.length > 0) {
        persistedRun = {
          ...updated,
          profileChange: {
            memoryIds: [...memoryIds],
            acceptedAt: new Date().toISOString(),
            revertedAt: null,
          },
        };
      }
      if (
        !deps.candidateStore.roleSkillAssessments.update(
          candidate.id,
          persistedRun,
          previous.revision,
        )
      ) {
        throw new Error('assessment_revision_conflict');
      }
    });
  } catch {
    return conflict(reply, request);
  }
  return reply.send({ data: { state: 'run', run: persistedRun } });
}

function importAcceptedSuggestions(
  deps: RouteDeps,
  candidateId: string,
  run: RoleSkillAssessmentRun,
  accepted: ReturnType<typeof buildSuggestionUpdates>,
): readonly string[] {
  if (accepted.length === 0) return [];
  const evidence: ResumeEvidenceImport = {
    sourceLabel: `Кандидат принял предложения проверки роли «${run.roleTitle}».`,
    sourceDigest: createHash('sha256')
      .update(JSON.stringify([run.id, accepted.map((item) => [item.original.id, item.statement])]))
      .digest('hex'),
    entries: accepted.map((item) => ({
      memoryId: randomUUID(),
      domain: item.original.domain,
      statement: item.statement,
    })),
  };
  const imported = deps.candidateStore.importResumeEvidence(candidateId, evidence);
  const count = deps.candidateStore.reviewMemories(candidateId, imported.memoryIds, 'confirm');
  if (count !== imported.memoryIds.length) throw new Error('profile_suggestion_commit_failed');
  return imported.memoryIds;
}

async function handleSuggestionRollback(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const candidate = await requireMutationCandidate(deps, request, reply);
  if (!candidate) return undefined;
  const { runId } = z.object({ runId: z.string().uuid() }).parse(request.params);
  const body = actionSchema.parse(request.body);
  const run = deps.candidateStore.roleSkillAssessments.get(candidate.id, runId);
  if (!run)
    return sendError(reply, request, 404, 'assessment_not_found', 'Проверка не найдена.', false);
  const digest = requestDigest('suggestions_rollback', runId, body);
  const replay = checkReplay(run, body.requestId, digest, request, reply);
  if (replay !== undefined) return replay;
  if (run.revision !== body.expectedRevision || !['cases', 'complete'].includes(run.status)) {
    return conflict(reply, request);
  }
  if (!run.profileChange?.memoryIds.length || run.profileChange.revertedAt) {
    return sendError(
      reply,
      request,
      409,
      'profile_suggestions_not_active',
      'Нет активных принятых предложений для отмены.',
      false,
    );
  }
  return singleFlight(
    deps,
    `${candidate.id}:${runId}`,
    digest,
    () => rollbackAcceptedSuggestions(deps, candidate.id, run, body, digest, reply, request),
    () => conflict(reply, request),
  );
}

function rollbackAcceptedSuggestions(
  deps: RouteDeps,
  candidateId: string,
  run: RoleSkillAssessmentRun,
  body: z.infer<typeof actionSchema>,
  digest: string,
  reply: FastifyReply,
  request: FastifyRequest,
) {
  const profileChange = run.profileChange!;
  const updated: RoleSkillAssessmentRun = {
    ...run,
    revision: run.revision + 1,
    updatedAt: new Date().toISOString(),
    profileChange: { ...profileChange, memoryIds: [], revertedAt: new Date().toISOString() },
    lastRequest: { id: body.requestId, digest },
  };
  try {
    deps.candidateStore.transaction(() => {
      const deleted = deps.candidateStore.reviewMemories(
        candidateId,
        profileChange.memoryIds,
        'delete',
      );
      if (deleted !== profileChange.memoryIds.length)
        throw new Error('profile_suggestion_rollback_failed');
      if (!deps.candidateStore.roleSkillAssessments.update(candidateId, updated, run.revision)) {
        throw new Error('assessment_revision_conflict');
      }
    });
  } catch {
    return conflict(reply, request);
  }
  return reply.send({
    data: { state: run.status === 'complete' ? 'result' : 'run', run: updated },
  });
}
