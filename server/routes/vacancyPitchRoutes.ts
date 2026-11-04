import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  detectVacancyLanguage,
  filterUsablePitchFacts,
  generateVacancyPitch,
  letterCareer,
  letterModelFacts,
  type PitchLanguage,
  type PitchTone,
  type PitchWorkplace,
  type VacancyPitchInputFact,
} from '../domain/vacancyPitchService';
import { COVER_LETTER_BUDGET_MS, withinTimeBudget } from '../providers/coverLetterWriter';
import { translateLetterFacts } from '../domain/letterFactTranslation';
import { letterFactsToTranslate, withTranslatedStatements } from '../domain/letterResults';
import type { PitchFactRankingContext } from '../domain/pitchFactRanking';
import type { RouteDeps } from './deps';
import { requireTariffQuota } from './tariffQuotaGuard';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import { wantedCompanyKeys } from '../domain/wantedCompanyOrder';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { pitchRankingContext } from './pitchRankingContext';
import { checkGeneratedTextFacts, checkPitchOutputFacts, generatedTextFactNotices, type GeneratedClaimCheck, type GeneratedTextFactCheck } from '../domain/generatedTextFactGate';
import { reviewLetterBody, type LetterGateSources, type LetterGateViolation } from '../domain/letterModelGate';

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

/** Перевод результатов идёт до письма: модель цитирует и проверка сверяет один и тот же текст. */
const LETTER_TRANSLATION_BUDGET_MS = 5_000;

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

/** B422: письмо знает, что кандидат отметил компанию «Хочу в эту компанию». */
function isWantedCompany(deps: RouteDeps, candidateId: string, company: string | undefined): boolean {
  if (!company) return false;
  return wantedCompanyKeys(deps.candidateCompanyWantsRepo, candidateId).has(candidateCompanyKey(company));
}

interface LetterWritingRequest {
  readonly vacancy: {
    title: string;
    company?: string;
    description?: string;
    requiredSkills: readonly string[];
    recipient?: { name?: string; role?: string };
  };
  /** Факты с переведёнными формулировками: письмо и проверка видят один текст. */
  readonly facts: readonly VacancyPitchInputFact[];
  readonly workplaces: readonly PitchWorkplace[];
  readonly language: PitchLanguage;
  readonly tone: PitchTone;
  readonly rankingContext: PitchFactRankingContext | undefined;
  readonly contextMs: number;
}

function letterGateSources(request: LetterWritingRequest): LetterGateSources {
  const { vacancy, facts, workplaces, language } = request;
  return {
    candidate: filterUsablePitchFacts(facts).map((fact) => fact.statement),
    career: letterCareer(workplaces, language).map((place) =>
      [place.title, place.employer, place.years].filter(Boolean).join(' ')),
    vacancy: [vacancy.title, vacancy.company, vacancy.recipient?.name, vacancy.recipient?.role, ...vacancy.requiredSkills]
      .flatMap((part) => (part ? [part] : [])),
  };
}

/** Сводка для кандидата: прежний разбор утверждений и всё, что остановила проверка письма. */
function letterFactCheck(
  body: string,
  facts: readonly VacancyPitchInputFact[],
  violations: readonly LetterGateViolation[],
): GeneratedTextFactCheck {
  const check = checkGeneratedTextFacts(body, facts);
  if (violations.length === 0) return { ...check, status: 'checked' };
  const known = new Set(check.claims.map((claim) => claim.text));
  const added = [...new Set(violations.map((violation) => violation.sentence))]
    .filter((sentence) => !known.has(sentence))
    .map((text): GeneratedClaimCheck => ({ text, status: 'not_in_profile', evidenceIds: [], action: 'ask_candidate' }));
  return { ...check, status: 'needs_confirmation', claims: [...check.claims, ...added] };
}

/** Model writing is bounded; the deterministic template remains the fallback. */
async function writeCoverLetterBody(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  letter: LetterWritingRequest,
): Promise<{ body?: string; stage?: string; factCheck?: GeneratedTextFactCheck }> {
  const { coverLetterWriter } = deps;
  if (!coverLetterWriter) return {};
  const { vacancy, facts, workplaces, language, tone, rankingContext, contextMs } = letter;
  const sources = letterGateSources(letter);
  let refused: GeneratedTextFactCheck | undefined;
  const review = (body: string): string[] => {
    const violations = reviewLetterBody(body, sources);
    if (violations.length > 0) refused = letterFactCheck(body, facts, violations);
    return violations.map((violation) => violation.rule);
  };
  const writing = coverLetterWriter.writeCoverLetter({
    facts: letterModelFacts(facts, workplaces, language).map((fact) => ({
      ref: fact.id,
      statement: fact.statement,
      domain: fact.domain,
      createdAt: fact.createdAt,
      updatedAt: fact.updatedAt,
      status: fact.status,
    })),
    career: letterCareer(workplaces, language),
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
    review,
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
  if (!outcome.body) return refused ? { factCheck: refused } : {};
  // A writer outside the queue answers here: nothing unchecked reaches the candidate.
  const violations = reviewLetterBody(outcome.body, sources);
  const factCheck = letterFactCheck(outcome.body, facts, violations);
  return violations.length === 0 ? { body: outcome.body, stage: outcome.stage, factCheck } : { factCheck };
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

/** Места работы профиля для письма; доказательства — только годные для письма факты. */
function letterWorkplaces(
  snapshot: ReturnType<RouteDeps['candidateStore']['getSnapshot']>,
  usableEvidenceIds: ReadonlySet<string>,
) {
  return (snapshot.resume?.draft.experience ?? []).map((workplace) => ({
    id: workplace.id,
    employer: workplace.employer ?? null,
    title: workplace.title ?? null,
    startDate: workplace.startDate ?? null,
    endDate: workplace.endDate ?? null,
    current: workplace.current,
    recordId: workplace.chronologyMemoryId ?? null,
    evidenceIds: [workplace.chronologyMemoryId, ...workplace.bulletMemoryIds].filter((id) => usableEvidenceIds.has(id)),
  }));
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
  const candidateWorkplaces = letterWorkplaces(snapshot, usableEvidenceIds);
  const tone = body?.tone ?? 'executive';
  const language = body?.language ?? detectVacancyLanguage(vacancy);
  const workplaces = candidateWorkplaces.filter((place) => place.evidenceIds.some((id) => !excludedEvidenceIds.has(id)));
  const contextMs = Date.now() - contextStart;
  const toTranslate = letterFactsToTranslate(facts, workplaces, language);
  const translations = await translateLetterFacts(deps.experienceFactRewriter, toTranslate, LETTER_TRANSLATION_BUDGET_MS);
  const written = await writeCoverLetterBody(deps, request, candidateId, {
    vacancy, facts: withTranslatedStatements(facts, translations), workplaces, language, tone, rankingContext, contextMs,
  });
  if (translations.size < toTranslate.length) {
    request.log.warn({ wanted: toTranslate.length, translated: translations.size }, 'letter-result-translation-incomplete');
  }
  const pitch = generateVacancyPitch({
    vacancy,
    candidateName: snapshot.resume?.draft?.candidate?.fullName,
    facts,
    tone,
    ...(rankingContext ? { rankingContext } : {}),
    language,
    ...(body?.recipient ? { recipient: body.recipient } : {}),
    ...(isWantedCompany(deps, candidateId, vacancy.company) ? { targetCompany: true } : {}),
    workplaces,
    translations,
  });
  const atsCoverLetter = written.body ?? pitch.atsCoverLetter;
  const templateChecks = checkPitchOutputFacts(pitch, atsCoverLetter, withTranslatedStatements(facts, translations));
  // The letter screen shows emailPitch.body: the model letter has to be there, not only in the ATS field.
  return written.body && written.factCheck
    ? {
        pitch: { ...pitch, emailPitch: { ...pitch.emailPitch, body: written.body } },
        written,
        atsCoverLetter,
        candidateWorkplaces,
        outputFactChecks: { ...templateChecks, emailBody: written.factCheck, atsCoverLetter: written.factCheck },
      }
    : { pitch, written, atsCoverLetter, candidateWorkplaces, outputFactChecks: templateChecks };
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
  // B579: письмо к вакансии — единица квоты откликов; повтор к той же вакансии бесплатен.
  if (!requireTariffQuota(deps, request, reply, candidate.id, 'applications', vacancyId)) return undefined;
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
      // One note under the letter (G3 L2, mockup 9); the fact gate's goes first (B528).
      // A model letter passed its gate; notes about the template it replaced would not apply.
      notices: [...generatedTextFactNotices(
        result.pitch.language,
        result.written.body ? [] : Object.values(result.outputFactChecks),
        result.written.factCheck,
      ), ...result.pitch.notices].slice(0, 1),
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
