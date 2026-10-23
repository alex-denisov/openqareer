import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  filterUsablePitchFacts,
  generateVacancyPitch,
  type PitchLanguage,
  type PitchTone,
  type VacancyPitchInputFact,
} from '../domain/vacancyPitchService';
import { COVER_LETTER_BUDGET_MS, withinTimeBudget } from '../providers/coverLetterWriter';
import type { PitchFactRankingContext } from '../domain/pitchFactRanking';
import type { RouteDeps } from './deps';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import { wantedCompanyKeys } from '../domain/wantedCompanyOrder';
import {
  authenticateCandidate,
  candidateHasLlmAccess,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { pitchRankingContext } from './pitchRankingContext';
import { checkGeneratedTextFacts, checkPitchOutputFacts, generatedTextFactNotices, type GeneratedTextFactCheck } from '../domain/generatedTextFactGate';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

const vacancyPitchInputSchema = z
  .object({
    tone: z.enum(['executive', 'confident', 'technical']).optional(),
    /** Overrides language auto-detected from the vacancy's own text (B266). */
    language: z.enum(['en', 'ru']).optional(),
    excludedEvidenceIds: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
    /** Saved, candidate-owned cover letter for an application card (B251). */
    applicationId: z.string().trim().min(1).max(200).optional(),
    recipient: z
      .object({
        name: z.string().trim().min(1).max(200).optional(),
        role: z.string().trim().max(200).optional(),
      })
      .optional(),
    vacancy: z
      .object({
        title: z.string().trim().min(1).optional(),
        company: z.string().trim().optional(),
        description: z.string().optional(),
        requiredSkills: z.array(z.string()).optional(),
        responsibilities: z.array(z.string()).optional(),
        location: z.string().optional(),
        isRemote: z.boolean().optional(),
      })
      .optional(),
  })
  .optional();
const approvedLetterSnapshotSchema = z.object({
  circle: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  language: z.enum(['en', 'ru']),
  tone: z.enum(['executive', 'confident', 'technical']),
  recipient: z.object({
    id: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    role: z.string().trim().max(200).optional(),
    company: z.string().trim().max(200).optional(),
  }).optional(),
  subject: z.string().trim().max(300).optional(),
  body: z.string().trim().min(1).max(12000),
  usedEvidenceIds: z.array(z.string().trim().min(1).max(200)).max(200),
  includedWorkplaceIds: z.array(z.string().trim().min(1).max(200)).max(100),
});

/**
 * Раскладка времени письма на составляющие: сборка контекста (снимок
 * кандидата + разбор роли кампании) отдельно от ожидания провайдера. Только
 * числа и имя ступени — ни текста письма, ни фактов кандидата (C46).
 */
function logPitchTiming(entry: {
  readonly contextMs: number;
  readonly providerMs: number;
  readonly totalMs: number;
  readonly stage?: string;
}): void {
  console.info(JSON.stringify({ event: 'vacancy-pitch-timing', ...entry }));
}

function toUsableCoverLetterFacts(facts: readonly VacancyPitchInputFact[]) {
  return filterUsablePitchFacts(facts).map((fact) => ({
    ref: fact.id,
    statement: fact.statement,
    domain: fact.domain,
    createdAt: fact.createdAt,
    updatedAt: fact.updatedAt,
    status: fact.status,
  }));
}

/** B422: письмо знает, что кандидат отметил компанию «Хочу в эту компанию». */
function isWantedCompany(deps: RouteDeps, candidateId: string, company: string | undefined): boolean {
  if (!company) return false;
  return wantedCompanyKeys(deps.candidateCompanyWantsRepo, candidateId).has(candidateCompanyKey(company));
}

/** Model writing is bounded; the deterministic template remains the fallback. */
async function writeCoverLetterBody(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  vacancy: {
    title: string;
    company?: string;
    description?: string;
    requiredSkills: readonly string[];
    recipient?: { name?: string; role?: string };
  },
  facts: readonly VacancyPitchInputFact[],
  language: PitchLanguage,
  tone: PitchTone,
  rankingContext: PitchFactRankingContext | undefined,
  contextMs: number,
): Promise<{ body?: string; stage?: string; factCheck?: GeneratedTextFactCheck }> {
  const { coverLetterWriter } = deps;
  if (!coverLetterWriter || !candidateHasLlmAccess(deps, candidateId)) return {};
  const writing = coverLetterWriter.writeCoverLetter({
    facts: toUsableCoverLetterFacts(facts),
    vacancy: {
      title: vacancy.title,
      ...(vacancy.company ? { company: vacancy.company } : {}),
      ...(vacancy.description ? { description: vacancy.description } : {}),
      requirements: vacancy.requiredSkills,
      ...(rankingContext ? { rankingContext } : {}),
      ...(vacancy.recipient ? { recipient: vacancy.recipient } : {}),
      ...(isWantedCompany(deps, candidateId, vacancy.company) ? { targetCompany: true as const } : {}),
    },
    language,
    tone,
  });
  const providerStart = Date.now();
  const outcome = await withinTimeBudget(writing, COVER_LETTER_BUDGET_MS);
  const providerMs = Date.now() - providerStart;
  if (outcome.failure) request.log.warn(outcome.failure, 'cover-letter-stage-failed');
  const stage = outcome.stage ?? outcome.failure?.stage;
  logPitchTiming({
    contextMs,
    providerMs,
    totalMs: contextMs + providerMs,
    ...(stage ? { stage } : {}),
  });
  if (!outcome.body) return {};
  const factCheck = checkGeneratedTextFacts(outcome.body, facts);
  return factCheck.status === 'checked'
    ? { body: outcome.body, stage: outcome.stage, factCheck }
    : { factCheck };
}

function resolvePitchVacancy(
  body: z.infer<typeof vacancyPitchInputSchema>,
  vacancyId: string,
  cluster: ReturnType<RouteDeps['multiSourceEngine']['getActiveCluster']>,
  poolVacancy: ReturnType<NonNullable<RouteDeps['multiSourceEngine']['getVacancy']>> | undefined,
) {
  return {
    id: vacancyId,
    title: body?.vacancy?.title ?? cluster?.canonicalTitle ?? poolVacancy?.title,
    company: body?.vacancy?.company ?? cluster?.canonicalCompany ?? poolVacancy?.company,
    description:
      body?.vacancy?.description ?? cluster?.descriptionSummary ?? poolVacancy?.description,
    requiredSkills:
      body?.vacancy?.requiredSkills ?? cluster?.skills ?? poolVacancy?.requiredSkills ?? [],
    responsibilities: body?.vacancy?.responsibilities ?? poolVacancy?.responsibilities ?? [],
    location: body?.vacancy?.location ?? cluster?.canonicalLocation ?? poolVacancy?.location,
    isRemote: body?.vacancy?.isRemote ?? cluster?.isRemote ?? poolVacancy?.isRemote ?? false,
    recipient: body?.recipient,
  };
}

function vacancyNotFoundResponse(
  reply: FastifyReply,
  request: FastifyRequest,
  multiSourceEngine: RouteDeps['multiSourceEngine'],
  vacancyId: string,
) {
  if (multiSourceEngine.isKnownVacancyGone(vacancyId)) {
    return sendError(
      reply,
      request,
      410,
      'vacancy_gone',
      'Вакансия снята или обновилась — обновите список.',
      false,
    );
  }
  return sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
}

async function writeVacancyPitch(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  body: z.infer<typeof vacancyPitchInputSchema>,
  vacancy: ReturnType<typeof resolvePitchVacancy> & { title: string },
) {
  const contextStart = Date.now();
  const rankingContext = pitchRankingContext(deps.candidateStore, deps.titleParseStore, candidateId, vacancy.title);
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const allFacts = snapshot.memory ?? [];
  const excludedEvidenceIds = new Set(body?.excludedEvidenceIds ?? []);
  const facts = allFacts.filter((fact) => !excludedEvidenceIds.has(fact.id));
  const usableEvidenceIds = new Set(filterUsablePitchFacts(allFacts).map((fact) => fact.id));
  const candidateWorkplaces = (snapshot.resume?.draft.experience ?? []).map((workplace) => ({
    id: workplace.id,
    employer: workplace.employer ?? null,
    title: workplace.title ?? null,
    startDate: workplace.startDate ?? null,
    endDate: workplace.endDate ?? null,
    current: workplace.current,
    evidenceIds: [workplace.chronologyMemoryId, ...workplace.bulletMemoryIds].filter((id) => usableEvidenceIds.has(id)),
  }));
  const tone = body?.tone ?? 'executive';
  const pitch = generateVacancyPitch({
    vacancy,
    candidateName: snapshot.resume?.draft?.candidate?.fullName,
    facts,
    tone,
    ...(rankingContext ? { rankingContext } : {}),
    ...(body?.language ? { language: body.language } : {}),
    ...(body?.recipient ? { recipient: body.recipient } : {}),
    ...(isWantedCompany(deps, candidateId, vacancy.company) ? { targetCompany: true } : {}),
  });
  const contextMs = Date.now() - contextStart;
  const written = await writeCoverLetterBody(
    deps,
    request,
    candidateId,
    vacancy,
    facts,
    pitch.language,
    tone,
    rankingContext,
    contextMs,
  );
  const atsCoverLetter = written.body ?? pitch.atsCoverLetter;
  const outputFactChecks = checkPitchOutputFacts(pitch, atsCoverLetter, facts);
  return { pitch, written, atsCoverLetter, candidateWorkplaces, outputFactChecks };
}

function saveGeneratedCoverLetter(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  applicationId: string,
  content: string,
): void {
  candidateStore.saveDocumentAndLinkApplicationMaterial(
    candidateId,
    applicationId,
    'cover_letter',
    {
      kind: 'cover_letter',
      source: 'generated',
      fileName: 'cover-letter.txt',
      mimeType: 'text/plain',
      contentBase64: Buffer.from(content, 'utf8').toString('base64'),
      parseStatus: 'not_applicable',
    },
  );
}

const handleGenerateVacancyPitch: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, multiSourceEngine } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  const body = vacancyPitchInputSchema.parse(request.body ?? {});
  if (body?.applicationId && !candidateStore.getApplication(candidate.id, body.applicationId)) {
    return sendError(reply, request, 404, 'application_not_found', 'Отклик не найден.', false);
  }

  const cluster = multiSourceEngine.getActiveCluster(vacancyId);
  const sourceId = vacancyId.startsWith('cluster-')
    ? vacancyId.slice('cluster-'.length)
    : vacancyId;
  const loaded = await multiSourceEngine.loadVacancyDescription(sourceId);
  const poolVacancy = loaded.vacancy ?? multiSourceEngine.getVacancy?.(sourceId);
  const vacancy = resolvePitchVacancy(body, vacancyId, cluster, poolVacancy);
  if (!vacancy.title) {
    return vacancyNotFoundResponse(reply, request, multiSourceEngine, vacancyId);
  }
  const result = await writeVacancyPitch(deps, request, candidate.id, body, {
    ...vacancy,
    title: vacancy.title,
  });
  if (body?.applicationId) {
    saveGeneratedCoverLetter(
      candidateStore,
      candidate.id,
      body.applicationId,
      result.atsCoverLetter,
    );
  }
  return {
    data: {
      ...result.pitch,
      atsCoverLetter: result.atsCoverLetter,
      candidateWorkplaces: result.candidateWorkplaces,
      outputFactChecks: result.outputFactChecks,
      ...(result.written.factCheck ? { factCheck: result.written.factCheck } : {}),
      notices: [...result.pitch.notices, ...generatedTextFactNotices(
        result.pitch.language, Object.values(result.outputFactChecks), result.written.factCheck,
      )],
      bodySource: result.written.body ? ('model' as const) : ('template' as const),
      ...(result.written.body && result.written.stage ? { stage: result.written.stage } : {}),
    },
    meta: { requestId: request.id },
  };
};

function invalidLetterSnapshot(reply: FastifyReply, request: FastifyRequest) {
  return sendError(reply, request, 400, 'invalid_letter_snapshot', 'Проверьте текст письма и повторите одобрение.', false);
}

function changedLetterEvidence(reply: FastifyReply, request: FastifyRequest) {
  return sendError(reply, request, 400, 'letter_evidence_changed', 'Факты письма изменились. Подготовьте письмо ещё раз.', false);
}

const handleApproveVacancyLetter: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, multiSourceEngine } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  const parsed = approvedLetterSnapshotSchema.safeParse(request.body);
  if (!parsed.success) return invalidLetterSnapshot(reply, request);
  const cluster = multiSourceEngine.getActiveCluster(vacancyId);
  if (!cluster) return vacancyNotFoundResponse(reply, request, multiSourceEngine, vacancyId);
  const evidenceIds = new Set(
    filterUsablePitchFacts(candidateStore.getSnapshot(candidate.id).memory).map((fact) => fact.id),
  );
  if (parsed.data.usedEvidenceIds.some((id) => !evidenceIds.has(id))) {
    return changedLetterEvidence(reply, request);
  }
  const approvedAt = new Date().toISOString();
  const stored = persistApprovedLetterSnapshot(
    candidateStore,
    candidate.id,
    vacancyId,
    cluster,
    parsed.data,
    approvedAt,
  );
  return {
    data: {
      applicationId: stored.application.id,
      documentId: stored.document.id,
      approvedAt,
      status: 'approved',
      sent: false,
    },
    meta: { requestId: request.id },
  };
};

function persistApprovedLetterSnapshot(
  candidateStore: RouteDeps['candidateStore'],
  candidateId: string,
  vacancyId: string,
  cluster: NonNullable<ReturnType<RouteDeps['multiSourceEngine']['getActiveCluster']>>,
  input: z.infer<typeof approvedLetterSnapshotSchema>,
  approvedAt: string,
) {
  return candidateStore.transaction(() => {
    const application = candidateStore.createApplication(candidateId, {
      clusterId: vacancyId,
      stage: 'saved',
      manualVacancy: {
        title: cluster.canonicalTitle,
        company: cluster.canonicalCompany,
        url: cluster.primaryUrl,
        source: cluster.sources[0]?.sourceName ?? cluster.sources[0]?.sourceType ?? 'Источник не указан',
      },
    });
    const approvalId = randomUUID();
    const snapshot = {
      version: 1, approvalId, vacancyId, applicationId: application.id, approvedAt,
      circle: input.circle, language: input.language, tone: input.tone,
      recipient: input.recipient ?? null, subject: input.subject ?? null, body: input.body,
      usedEvidenceIds: input.usedEvidenceIds, includedWorkplaceIds: input.includedWorkplaceIds, sent: false,
    };
    const document = candidateStore.saveDocumentAndLinkApplicationMaterial(
      candidateId,
      application.id,
      'cover_letter',
      {
        kind: 'cover_letter',
        source: 'generated',
        fileName: 'approved-letter-' + approvalId + '.json',
        mimeType: 'application/json',
        contentBase64: Buffer.from(JSON.stringify(snapshot), 'utf8').toString('base64'),
        extractedText: input.body,
        parseStatus: 'not_applicable',
      },
    ).document;
    return { application, document };
  });
}

export function registerVacancyPitchRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post(
    '/api/v1/candidate/vacancies/:id/pitch',
    { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } },
    withDeps(deps, handleGenerateVacancyPitch),
  );
  app.post(
    '/api/v1/candidate/vacancies/:id/letter-approvals',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    withDeps(deps, handleApproveVacancyLetter),
  );
}
