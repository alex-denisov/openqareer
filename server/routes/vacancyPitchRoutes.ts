import { candidateGenderFromName } from '../../shared/candidateGender';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  detectVacancyLanguage,
  filterUsablePitchFacts,
  generateVacancyPitch,
} from '../domain/vacancyPitchService';
import { retryOnSqliteBusy } from '../data/sqliteBusyRetry';
import { modelLetterNotice, writeCoverLetterBody } from './vacancyLetterBody';
import { translateLetterFacts } from '../domain/letterFactTranslation';
import { letterFactsToTranslate, withTranslatedStatements } from '../domain/letterResults';
import type { RouteDeps } from './deps';
import { releaseTariffQuota, requireTariffQuota } from './tariffQuotaGuard';
import {
  attachApprovedResume,
  generalResumeOf,
  letterResumeState,
  prepareLetterResume,
  ResumeSnapshotError,
} from './letterApprovalResume';
import { currentMaster, masterProjectionOf } from './resumeMaster';
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
import { letterProfileText } from '../domain/letterProfile';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import { checkPitchOutputFacts, generatedTextFactNotices } from '../domain/generatedTextFactGate';

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
  /** С каким признаком резюме написан черновик: не совпал с текущим — письмо готовится заново. */
  resumeAvailable: z.boolean().optional(),
  /** Снимок не создался, и кандидат выбрал своё общее резюме. */
  generalResumeId: z.string().trim().min(1).max(200).optional(),
});

/** Перевод результатов идёт до письма: модель цитирует и проверка сверяет один и тот же текст. */
const LETTER_TRANSLATION_BUDGET_MS = 5_000;

/** B422: письмо знает, что кандидат отметил компанию «Хочу в эту компанию». */
function isWantedCompany(deps: RouteDeps, candidateId: string, company: string | undefined): boolean {
  if (!company) return false;
  return wantedCompanyKeys(deps.candidateCompanyWantsRepo, candidateId).has(candidateCompanyKey(company));
}

export function resolvePitchVacancy(
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
    // Письмо модели пишется по полному тексту из пула: экран письма присылает в description сводку (B601).
    fullDescription:
      poolVacancy?.description ?? body?.vacancy?.description ?? cluster?.descriptionSummary,
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

/** Всё, что письму нужно из базы; занятая база здесь не доходит до вызова модели. */
function readLetterContext(
  deps: RouteDeps,
  candidateId: string,
  body: z.infer<typeof vacancyPitchInputSchema>,
  vacancy: ReturnType<typeof resolvePitchVacancy> & { title: string },
) {
  const contextStart = Date.now();
  const rankingContext = pitchRankingContext(deps.candidateStore, deps.titleParseStore, candidateId, vacancy.title);
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const allFacts = snapshot.memory ?? [];
  const excludedEvidenceIds = new Set(body?.excludedEvidenceIds ?? []);
  const usableEvidenceIds = new Set(filterUsablePitchFacts(allFacts).map((fact) => fact.id));
  const candidateWorkplaces = letterWorkplaces(snapshot, usableEvidenceIds);
  const facts = allFacts.filter((fact) => !excludedEvidenceIds.has(fact.id));
  const workplaces = candidateWorkplaces.filter((place) => place.evidenceIds.some((id) => !excludedEvidenceIds.has(id)));
  return {
    rankingContext,
    candidateName: snapshot.resume?.draft?.candidate?.fullName,
    resume: letterResumeState(deps, candidateId, masterProjectionOf(snapshot).master),
    facts,
    candidateWorkplaces,
    workplaces,
    profile: letterProfileText({
      draft: snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT,
      facts,
      includedWorkplaceIds: workplaces.map((place) => place.id),
      withheldEvidenceIds: new Set([
        ...excludedEvidenceIds,
        ...allFacts.filter((fact) => fact.sensitive === true).map((fact) => fact.id),
      ]),
    }),
    targetCompany: isWantedCompany(deps, candidateId, vacancy.company),
    tone: body?.tone ?? 'executive',
    language: body?.language ?? detectVacancyLanguage(vacancy),
    contextMs: Date.now() - contextStart,
  } as const;
}

async function writeVacancyPitch(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  body: z.infer<typeof vacancyPitchInputSchema>,
  vacancy: ReturnType<typeof resolvePitchVacancy> & { title: string },
) {
  const context = await retryOnSqliteBusy(() => readLetterContext(deps, candidateId, body, vacancy));
  const { rankingContext, candidateName, facts, candidateWorkplaces, workplaces, targetCompany, tone, language, profile, contextMs, resume } = context;
  const toTranslate = letterFactsToTranslate(facts, workplaces, language);
  const translations = await translateLetterFacts(deps.experienceFactRewriter, toTranslate, LETTER_TRANSLATION_BUDGET_MS);
  const translatedFacts = withTranslatedStatements(facts, translations);
  const gender = candidateGenderFromName(candidateName);
  const written = await writeCoverLetterBody(deps.coverLetterWriter, request, {
    vacancy: { ...vacancy, description: vacancy.fullDescription },
    profile,
    facts: translatedFacts,
    language,
    ...(gender ? { gender } : {}),
    ...(body?.language ? { chosenLanguage: body.language } : {}),
    resumeAttached: resume.available, contextMs,
  });
  if (translations.size < toTranslate.length) {
    request.log.warn({ wanted: toTranslate.length, translated: translations.size }, 'letter-result-translation-incomplete');
  }
  const pitch = generateVacancyPitch({
    vacancy,
    candidateName,
    facts,
    tone,
    ...(rankingContext ? { rankingContext } : {}),
    language,
    ...(body?.recipient ? { recipient: body.recipient } : {}),
    ...(targetCompany ? { targetCompany: true } : {}),
    workplaces,
    translations,
  });
  const atsCoverLetter = written.body ?? pitch.atsCoverLetter;
  const templateChecks = checkPitchOutputFacts(pitch, atsCoverLetter, translatedFacts);
  // The letter screen shows emailPitch.body: the model letter has to be there, not only in the ATS field.
  return written.body && written.factCheck
    ? {
        pitch: { ...pitch, emailPitch: { ...pitch.emailPitch, body: written.body } },
        written,
        atsCoverLetter,
        candidateWorkplaces,
        resume,
        outputFactChecks: { ...templateChecks, emailBody: written.factCheck, atsCoverLetter: written.factCheck },
      }
    : { pitch, written, atsCoverLetter, candidateWorkplaces, resume, outputFactChecks: templateChecks };
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

/** Вход и отклик кандидата. Ничего не копит, можно повторить. Отказ уже отправлен, когда `undefined`. */
function readPitchAccess(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = vacancyPitchInputSchema.parse(request.body ?? {});
  if (body?.applicationId && !candidateStore.getApplication(candidate.id, body.applicationId)) {
    sendError(reply, request, 404, 'application_not_found', 'Отклик не найден.', false);
    return undefined;
  }
  return { candidateId: candidate.id, body };
}

/** Вакансия и квота. Единица квоты на вакансию считается один раз, поэтому шаг можно повторить. */
function reservePitchVacancy(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  access: NonNullable<ReturnType<typeof readPitchAccess>>,
  loaded: Awaited<ReturnType<RouteDeps['multiSourceEngine']['loadVacancyDescription']>>,
) {
  const { multiSourceEngine } = deps;
  const vacancyId = (request.params as { id: string }).id;
  const cluster = multiSourceEngine.getActiveCluster(vacancyId);
  const poolVacancy = loaded.vacancy ?? multiSourceEngine.getVacancy?.(pitchSourceId(vacancyId));
  const vacancy = resolvePitchVacancy(access.body, vacancyId, cluster, poolVacancy);
  if (!vacancy.title) {
    vacancyNotFoundResponse(reply, request, multiSourceEngine, vacancyId);
    return undefined;
  }
  // B579: письмо к вакансии — единица квоты откликов; повтор к той же вакансии бесплатен.
  if (!requireTariffQuota(deps, request, reply, access.candidateId, 'applications', vacancyId)) return undefined;
  return { ...vacancy, title: vacancy.title };
}

function pitchSourceId(vacancyId: string): string {
  return vacancyId.startsWith('cluster-') ? vacancyId.slice('cluster-'.length) : vacancyId;
}

/**
 * Занятая база на мгновение не доходит до кандидата (G3c, 03.11). Текст вакансии может идти по
 * сети, поэтому он читается один раз, вне повторов: повтор не запрашивает hh.ru второй раз.
 */
async function prepareVacancyPitch(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  const access = await retryOnSqliteBusy(() => readPitchAccess(deps, request, reply));
  if (!access) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  const loaded = await deps.multiSourceEngine.loadVacancyDescription(pitchSourceId(vacancyId));
  const vacancy = await retryOnSqliteBusy(() => reservePitchVacancy(deps, request, reply, access, loaded));
  return vacancy ? { ...access, vacancy } : undefined;
}

/** Одно примечание под письмом (G3 L2, макет 9): письму модели — что его написала модель. */
function letterNotices(result: Awaited<ReturnType<typeof writeVacancyPitch>>): string[] {
  const { pitch, written, outputFactChecks } = result;
  if (written.body) return [modelLetterNotice(pitch.language)];
  return [
    ...generatedTextFactNotices(pitch.language, Object.values(outputFactChecks)),
    ...pitch.notices,
  ].slice(0, 1);
}

const handleGenerateVacancyPitch: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const prepared = await prepareVacancyPitch(deps, request, reply);
  if (!prepared) return undefined;
  const { candidateId, body, vacancy } = prepared;
  const result = await writeVacancyPitch(deps, request, candidateId, body, vacancy);
  // Вся цепочка отказала: шаблон не подменяет письмо (решение владельца, 06.11), единица квоты возвращается.
  if (result.written.refused) {
    await retryOnSqliteBusy(() => releaseTariffQuota(deps, candidateId, 'applications', vacancy.id));
    return sendError(reply, request, 503, 'letter_generation_failed', LETTER_GENERATION_FAILED, true);
  }
  const { applicationId } = body ?? {};
  if (applicationId) {
    await retryOnSqliteBusy(() =>
      saveGeneratedCoverLetter(deps.candidateStore, candidateId, applicationId, result.atsCoverLetter));
  }
  return {
    data: {
      ...result.pitch,
      atsCoverLetter: result.atsCoverLetter,
      candidateWorkplaces: result.candidateWorkplaces,
      resumeAvailable: result.resume.available,
      resumeKind: result.resume.kind,
      outputFactChecks: result.outputFactChecks,
      ...(result.written.factCheck ? { factCheck: result.written.factCheck } : {}),
      notices: letterNotices(result),
      bodySource: result.written.body ? ('model' as const) : ('template' as const),
      ...(result.written.body && result.written.stage ? { stage: result.written.stage } : {}),
    },
    meta: { requestId: request.id },
  };
};

const LETTER_GENERATION_FAILED = 'Не удалось подготовить письмо. Попробуйте ещё раз.';

function invalidLetterSnapshot(reply: FastifyReply, request: FastifyRequest) {
  return sendError(reply, request, 400, 'invalid_letter_snapshot', 'Проверьте текст письма и повторите одобрение.', false);
}

function changedLetterEvidence(reply: FastifyReply, request: FastifyRequest) {
  return sendError(reply, request, 400, 'letter_evidence_changed', 'Факты письма изменились. Подготовьте письмо ещё раз.', false);
}

const RESUME_SNAPSHOT_FAILED = 'Не удалось подготовить резюме. Подготовьте его, чтобы одобрить письмо.';

function resumeSnapshotFailed(deps: RouteDeps, reply: FastifyReply, request: FastifyRequest, candidateId: string, error: ResumeSnapshotError) {
  request.log.error({ err: error.cause }, 'letter-resume-snapshot-failed');
  const generalResume = generalResumeOf(deps, candidateId);
  return sendError(reply, request, 503, 'resume_snapshot_failed', RESUME_SNAPSHOT_FAILED, true, undefined, { generalResume });
}

function changedLetterResume(reply: FastifyReply, request: FastifyRequest) {
  return sendError(reply, request, 409, 'letter_resume_changed', 'Резюме в профиле изменилось. Письмо подготовлено заново: проверьте его и одобрите.', false);
}

/** «Подготовить резюме»: повторяет снимок резюме под вакансию до одобрения, письмо не трогает. */
const handlePrepareLetterResume: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, multiSourceEngine } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const vacancyId = (request.params as { id: string }).id;
  const cluster = multiSourceEngine.getActiveCluster(vacancyId);
  if (!cluster) return vacancyNotFoundResponse(reply, request, multiSourceEngine, vacancyId);
  try {
    const state = prepareLetterResume(deps, candidate.id, cluster);
    return { data: { resumeAvailable: state.available, resumeKind: state.kind, ready: state.available }, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof ResumeSnapshotError) return resumeSnapshotFailed(deps, reply, request, candidate.id, error);
    throw error;
  }
};

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
  const resumeNow = letterResumeState(deps, candidate.id, currentMaster(deps, candidate.id).document);
  if (parsed.data.resumeAvailable !== undefined && parsed.data.resumeAvailable !== resumeNow.available) {
    return changedLetterResume(reply, request);
  }
  const approvedAt = new Date().toISOString();
  let stored: ReturnType<typeof persistApprovedLetterSnapshot>;
  try {
    stored = persistApprovedLetterSnapshot(deps, candidate.id, vacancyId, cluster, parsed.data, approvedAt);
  } catch (error) {
    if (error instanceof ResumeSnapshotError) return resumeSnapshotFailed(deps, reply, request, candidate.id, error);
    throw error;
  }
  return {
    data: {
      applicationId: stored.application.id,
      documentId: stored.document.id,
      approvedAt,
      status: 'approved',
      sent: false,
      resume: stored.resume,
    },
    meta: { requestId: request.id },
  };
};

function persistApprovedLetterSnapshot(
  deps: RouteDeps,
  candidateId: string,
  vacancyId: string,
  cluster: NonNullable<ReturnType<RouteDeps['multiSourceEngine']['getActiveCluster']>>,
  input: z.infer<typeof approvedLetterSnapshotSchema>,
  approvedAt: string,
) {
  const { candidateStore } = deps;
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
    const resume = attachApprovedResume(deps, candidateId, {
      applicationId: application.id,
      cluster,
      approvedAt,
      ...(input.generalResumeId ? { generalResumeId: input.generalResumeId } : {}),
    });
    return { application, document, resume };
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
  app.post(
    '/api/v1/candidate/vacancies/:id/letter-resume',
    { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } },
    withDeps(deps, handlePrepareLetterResume),
  );
}
