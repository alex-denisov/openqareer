import { createHash, randomUUID } from 'node:crypto';
import { connectNativeOnly, resolveNativeImportMode, type NativeImportMode } from './nativeImportMode';
import { materializeManualResumeEvidence } from './manualResumeEvidence';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  buildMemoryPage,
  buildMessagePage,
  buildSnapshotHead,
  buildTurnPage,
} from '../data/candidateSnapshotPage';
import { handleGetWorkspace, handlePutWorkspace } from './workspaceHandlers';
import { evaluateProductCase, productCaseSubmissionSchema } from '../domain/assessment';
import { coachTurnStageSchema } from '../domain/coach';
import { evaluateGermanyMarket, germanyMarketSubmissionSchema } from '../domain/germanyMarket';
import {
  buildResumeStudioProjection,
  validateResumeEvidenceFreshness,
  type ResumeEvidenceFreshness,
  type ResumeStudioProjection,
} from '../domain/resumeStudio';
import { resumeDraftSchema, EMPTY_RESUME_DRAFT, type ResumeDraft } from '../domain/resumeDraft';
import {
  carriesProfileSubstance,
  newImportMemoryIdPrefix,
  planResumeImport,
} from '../domain/resumeImport';
import { preferStructuredResume } from '../domain/resumeStructuring';
import { structureWithinBudget } from '../providers/resumeStructurer';
import { handleImportStructuredResume } from './structuredResumeImportRoute';
import { registerCandidateExperienceFactRoutes } from './candidateExperienceFactRoutes';
import { registerCandidateConsultantHistoryRoutes } from './candidateConsultantHistoryRoutes';
import { registerCandidateMediaRoutes } from './candidateMediaRoutes';
import { registerCandidateDocumentRoutes } from './candidateDocumentRoutes';
import { registerCandidateResumeVersionRoutes } from './candidateResumeVersionRoutes';
import { rebuildCampaignRoles } from '../vacancies/rebuildCampaignRoles';
import { resumeStructurerForCandidate, resumeStructurerForRequest } from './resumeLlmAccess';
import { parseResumeContent } from '../../src/features/workspace/resumeParser';
import { normalizeResumeSourceText } from '../../src/features/workspace/resumeSourceText';
import type { CandidateStore, ResumeReaderProvenance } from '../data/candidateStore';
import { modelReaderProvenance, rulesReaderProvenance } from '../domain/resumeReaderProvenance';
import type { RouteDeps } from './deps';
import { nativeSourceConnectionView } from '../connectors/nativeSourceConnection';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  previewAuth,
  sendError,
  withDeps,
} from './helpers';
import { cancelFootprintRunForCandidate } from '../osint/candidateFootprintWorker';
import {
  notificationRepositoryFor,
  recordImportCompletedNotification,
} from './notificationRepositoryAccess';
import { registerNotificationRoutes } from './notificationRoutes';
import {
  assessmentIdSchema,
  candidateCreateSchema,
  memoryChangeSchema,
  memoryIdSchema,
  memoryReviewSchema,
  resumeImportSchema,
} from './schemas';

export type Handler = (
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

interface ResumeStudioView {
  draft: ResumeDraft | null;
  savedAt: { createdAt: string; updatedAt: string } | null;
  projection: ResumeStudioProjection;
  evidenceFreshness: ResumeEvidenceFreshness;
  reader: ResumeReaderProvenance | null;
}

/**
 * Rebuilds both resume variants from the dossier as it stands now and compares
 * it with the evidence the candidate approved when the draft was saved, so a
 * revoked fact surfaces instead of surviving inside a generated document.
 */
export function resumeStudioView(
  candidateStore: CandidateStore,
  candidateId: string,
): ResumeStudioView {
  const snapshot = candidateStore.getSnapshot(candidateId);
  const stored = snapshot.resume;
  const projection = buildResumeStudioProjection({
    ...(stored?.draft ?? EMPTY_RESUME_DRAFT),
    evidence: snapshot.memory,
  });
  return {
    draft: stored?.draft ?? null,
    savedAt: stored ? { createdAt: stored.createdAt, updatedAt: stored.updatedAt } : null,
    projection,
    evidenceFreshness: validateResumeEvidenceFreshness(
      stored?.evidenceSnapshot ?? projection.evidenceSnapshot,
      snapshot.memory,
    ),
    reader: stored?.reader ?? null,
  };
}

/**
 * Reading is delegated to the configured model when one is available, because
 * heuristics alone mis-read real exports; the deterministic parser stays the
 * floor, so a provider outage degrades the result instead of losing it.
 */
async function readResume(
  text: string,
  structurer?: RouteDeps['resumeStructurer'],
): Promise<{
  resume: ReturnType<typeof parseResumeContent>;
  structuredBy: 'model' | 'rules';
  reader: ResumeReaderProvenance | null;
}> {
  // Both readers must see the same document. The model was handed the raw
  // extraction while only the rules parser repaired it, so on an hh.ru export
  // the model read `Проживает : Москва`, echoed the spacing into every title and
  // lost the fields the rules parser had already found (B178).
  const source = normalizeResumeSourceText(text);
  const deterministic = parseResumeContent(source);
  if (!structurer)
    return { resume: deterministic, structuredBy: 'rules', reader: rulesReaderProvenance() };
  // Модель — улучшение, а не условие: без потолка кандидат ждал её отказа
  // шесть с половиной минут (INC-037).
  const structured = await structureWithinBudget(source, structurer);
  if (!structured)
    return { resume: deterministic, structuredBy: 'rules', reader: rulesReaderProvenance() };
  return {
    resume: preferStructuredResume(structured, deterministic),
    structuredBy: 'model',
    reader: modelReaderProvenance(structurer),
  };
}

function evaluateAssessment(body: unknown) {
  const submission = productCaseSubmissionSchema.parse(body);
  return { submission, result: evaluateProductCase(submission) };
}

const handleCreateCandidate: Handler = async (deps, request, reply) => {
  const body = candidateCreateSchema.parse(request.body);
  const credentials = deps.candidateStore.createCandidate(body);
  return reply.code(201).send({
    data: credentials,
    meta: { requestId: request.id },
  });
};

const snapshotQuerySchema = z.object({
  memoryOffset: z.coerce.number().int().min(0).default(0),
  stage: coachTurnStageSchema.optional(),
});

const messagesQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  stage: coachTurnStageSchema.optional(),
});

const handleGetSnapshot: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { memoryOffset, stage } = snapshotQuerySchema.parse(request.query);
  // Целиком снимок до браузера не доезжает — маршрут рвёт ответ примерно на
  // 20 460 байт (INC-030). Экран получает голову снимка и дочитывает память.
  const { data, meta } = buildSnapshotHead(
    candidateStore.getSnapshot(candidate.id, stage),
    memoryOffset,
  );
  return { data, meta: { requestId: request.id, ...meta } };
};

/** Память страницами: голова снимка её не несёт (INC-030). */
const handleGetMemory: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { offset } = messagesQuerySchema.parse(request.query);
  const page = buildMemoryPage(candidateStore.getSnapshot(candidate.id).memory, offset);
  return {
    data: page.items,
    meta: {
      requestId: request.id,
      total: page.total,
      offset: page.offset,
      nextOffset: page.nextOffset,
    },
  };
};

/** Ходы страницами, от свежего к старому: один разбор бывает больше ответа. */
const handleGetTurns: Handler = async ({ authService, candidateStore, config }, request, reply) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { offset } = messagesQuerySchema.parse(request.query);
  const page = buildTurnPage(candidateStore.getSnapshot(candidate.id).turns, offset);
  return {
    data: page.items,
    meta: {
      requestId: request.id,
      total: page.total,
      offset: page.offset,
      nextOffset: page.nextOffset,
    },
  };
};

/** Диалог не едет в снимке: его читает только панель эксперта (INC-030). */
const handleGetMessages: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { offset, stage } = messagesQuerySchema.parse(request.query);
  const messages = candidateStore.getMessages(candidate.id, stage);
  const page = buildMessagePage(messages, offset);
  return {
    data: page.items,
    meta: {
      requestId: request.id,
      total: page.total,
      offset: page.offset,
      nextOffset: page.nextOffset,
    },
  };
};

const handleDeleteCandidate: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, candidateReputationRepo, recruiterContactsRepo, config } =
    deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  cancelFootprintRunForCandidate(candidate.id);
  deps.capabilityConsentStore?.deleteForCandidate(candidate.id);
  notificationRepositoryFor(deps).deleteByCandidate(candidate.id);
  candidateReputationRepo?.deleteFootprintAuditsByCandidateId(candidate.id);
  candidateReputationRepo?.deleteAuditsByCandidateId(candidate.id);
  deps.vacancyMechanics?.deleteCandidate(candidate.id);
  candidateStore.deleteCandidate(candidate.id);
  recruiterContactsRepo?.deleteContactsByCandidateId(candidate.id);
  recruiterContactsRepo?.deleteJobsByCandidateId(candidate.id);
  return reply.code(204).send();
};

const handleExportCandidate: Handler = async (
  { authService, candidateStore, candidateReputationRepo, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  reply.header('Content-Disposition', 'attachment; filename="openqareer-candidate-export.json"');
  return {
    data: {
      ...candidateStore.exportCandidate(candidate.id),
      reputationAudits:
        candidateReputationRepo?.listAudits(candidate.id, { trustedOnly: true }) ?? [],
      // Keep the singular key for clients that have not migrated yet.
      reputationAudit:
        candidateReputationRepo?.getLatestAudit(candidate.id, { trustedOnly: true }) ?? null,
      footprintAudits: candidateReputationRepo?.listFootprintAudits(candidate.id) ?? [],
    },
    meta: { requestId: request.id, exportedAt: new Date().toISOString() },
  };
};

const handleChangeMemory: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const memoryId = memoryIdSchema.parse((request.params as { memoryId: string }).memoryId);
  const change = memoryChangeSchema.parse(request.body);
  const memory = candidateStore.changeMemory(candidate.id, memoryId, change);
  if (!memory && change.action !== 'delete') {
    return sendError(reply, request, 404, 'memory_not_found', 'Элемент памяти не найден.', false);
  }
  return {
    data: { memory, deleted: change.action === 'delete' },
    meta: { requestId: request.id },
  };
};

const handleReviewMemories: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const review = memoryReviewSchema.parse(request.body);
  const reviewed = candidateStore.reviewMemories(candidate.id, review.memoryIds, review.action);
  if (reviewed === null) {
    return sendError(
      reply,
      request,
      404,
      'memory_not_found',
      'Один из фактов не найден — обновите страницу и повторите.',
      false,
    );
  }
  return {
    data: { reviewed, action: review.action },
    meta: { requestId: request.id },
  };
};

const handleSaveAssessment: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const assessmentId = assessmentIdSchema.parse(
    (request.params as { assessmentId: string }).assessmentId,
  );
  const evaluated = evaluateAssessment(request.body);
  const assessment = candidateStore.saveAssessment(
    candidate.id,
    assessmentId,
    evaluated.submission,
    evaluated.result,
  );
  return { data: assessment, meta: { requestId: request.id } };
};

const handleParseResume: Handler = async (deps, request) => {
  const body = z
    .object({
      text: z.string().min(10).max(500_000),
    })
    .parse(request.body);

  const parsed = await readResume(body.text, resumeStructurerForRequest(deps, request));
  return {
    data: parsed.resume,
    meta: { requestId: request.id, structuredBy: parsed.structuredBy },
  };
};

/**
 * The one door an imported resume walks through. It reads the document, writes
 * what the document stated into the dossier as confirmed evidence, and saves a
 * draft that cites exactly those facts — the three steps have to happen
 * together, or Resume Studio opens empty on a draft whose sources do not
 * exist (B148).
 */
async function importResumeIntoDossier(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  body: z.infer<typeof resumeImportSchema>,
) {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const mode = body.sourceReceipt
    ? resolveNativeImportMode(candidateStore, candidate.id, body.sourceReceipt.platform, body.importMode)
    : 'profile';
  const early = nativeImportShortcut(candidateStore, candidate.id, body, mode);
  if (early) return { data: early.data, meta: { requestId: request.id, ...early.meta } };
  const read = await readResume(body.text, resumeStructurerForCandidate(deps, candidate.id));
  const plan = planResumeImport(read.resume, { idPrefix: newImportMemoryIdPrefix(randomUUID()) });
  if (plan.evidence.length === 0 || !carriesProfileSubstance(read.resume)) {
    return sendError(
      reply,
      request,
      422,
      'resume_without_facts',
      'В документе не нашлось ни одного факта для профиля. Проверьте файл или добавьте опыт вручную.',
      false,
    );
  }
  const commit = resumeImportCommit(candidate.id, body, plan, read.reader);
  const committed =
    mode === 'replace_profile' && commit.sourceReceipt
      ? candidateStore.replaceProfileWithImport(candidate.id, { ...commit, sourceReceipt: commit.sourceReceipt })
      : candidateStore.commitResumeImport(candidate.id, commit);
  const digest = resumeDocumentDigest(candidate.id, body.source, body.text);
  recordImportCompletedNotification(deps, request, candidate.id, 'resume_import', digest);
  void rebuildCampaignRoles(deps, candidate.id).catch((error) => {
    request.log.error({ error }, 'campaign_roles_rebuild_failed');
  });
  return {
    data: {
      parsed: read.resume,
      resume: resumeStudioView(candidateStore, candidate.id),
      structuredBy: read.structuredBy,
      factCount: committed.evidence.memoryIds.length,
      ...(committed.sourceConnection
        ? { connection: nativeSourceConnectionView(committed.sourceConnection) }
        : {}),
    },
    meta: { requestId: request.id },
  };
}

/**
 * Answers a native import without reading the document: an exact retry, or a
 * platform that only connects (one import source per profile, 23.10.2026).
 * A connect-only retry never stands in for an explicit «replace».
 */
function nativeImportShortcut(
  candidateStore: CandidateStore,
  candidateId: string,
  body: z.infer<typeof resumeImportSchema>,
  mode: NativeImportMode,
) {
  const replay = nativeResumeImportReplay(candidateStore, candidateId, body);
  if (replay && !(mode === 'replace_profile' && replay.factCount === 0)) {
    // A repeated connect-only answer keeps saying so, or the client reads «0 facts imported».
    const connectOnly = mode === 'connect_only' && replay.factCount === 0;
    return {
      data: connectOnly ? { ...replay, connectOnly: true as const } : replay,
      meta: { idempotentReplay: true },
    };
  }
  if (mode !== 'connect_only' || !body.sourceReceipt) return undefined;
  const receipt = {
    ...body.sourceReceipt,
    importDigest: nativeImportDigest(candidateId, body.sourceReceipt, body.text),
  };
  return {
    data: {
      ...connectNativeOnly(candidateStore, candidateId, receipt),
      resume: resumeStudioView(candidateStore, candidateId),
    },
    meta: {},
  };
}

function nativeResumeImportReplay(
  candidateStore: CandidateStore,
  candidateId: string,
  body: z.infer<typeof resumeImportSchema>,
) {
  if (!body.sourceReceipt) return undefined;
  const replay = candidateStore.findNativeSourceConnectionByDigest(
    candidateId,
    body.sourceReceipt.platform,
    nativeImportDigest(candidateId, body.sourceReceipt, body.text),
  );
  if (!replay) return undefined;
  return {
    parsed: parseResumeContent(body.text),
    resume: resumeStudioView(candidateStore, candidateId),
    structuredBy: 'rules' as const,
    factCount: replay.receipt.factCount,
    connection: nativeSourceConnectionView(replay),
  };
}

function resumeImportLabel(source: 'pdf' | 'linkedin' | 'hh' | 'text', fileName?: string): string {
  const origin = {
    pdf: 'PDF-резюме',
    linkedin: 'профиль LinkedIn',
    hh: 'резюме hh.ru',
    text: 'текст резюме',
  }[source];
  return fileName ? `Импорт: ${origin} «${fileName}»` : `Импорт: ${origin}`;
}

function resumeImportCommit(
  candidateId: string,
  body: z.infer<typeof resumeImportSchema>,
  plan: ReturnType<typeof planResumeImport>,
  reader: ReturnType<typeof rulesReaderProvenance> | null,
) {
  return {
    evidence: {
      sourceLabel: resumeImportLabel(body.source, body.fileName),
      platform:
        body.source === 'linkedin' || body.source === 'hh' ? body.source : ('file' as const),
      sourceDigest: resumeDocumentDigest(candidateId, body.source, body.text),
      entries: plan.evidence.map((item) => ({
        memoryId: item.memoryId,
        domain: item.domain,
        statement: item.statement,
      })),
    },
    draft: plan.draft,
    reader,
    sourceReceipt: body.sourceReceipt
      ? {
          ...body.sourceReceipt,
          importDigest: nativeImportDigest(candidateId, body.sourceReceipt, body.text),
        }
      : undefined,
  };
}

/**
 * Identifies the imported document for the candidate, so a re-upload of the
 * same file updates its "Импорт: ..." history line instead of adding another
 * one (B247 S6).
 */
function resumeDocumentDigest(
  candidateId: string,
  source: z.infer<typeof resumeImportSchema>['source'],
  text: string,
): string {
  return createHash('sha256')
    .update(candidateId)
    .update('\0')
    .update(source)
    .update('\0')
    .update(text)
    .digest('hex');
}

function nativeImportDigest(
  candidateId: string,
  receipt: NonNullable<z.infer<typeof resumeImportSchema>['sourceReceipt']>,
  text: string,
): string {
  return createHash('sha256')
    .update(candidateId)
    .update('\0')
    .update(receipt.platform)
    .update('\0')
    .update(receipt.sourceUrl)
    .update('\0')
    .update(text)
    .digest('hex');
}

const handleImportResume: Handler = async (deps, request, reply) => {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const body = resumeImportSchema.parse(request.body);
  if (body.structuredFallback) {
    request.log.warn({ reason: body.structuredFallback }, 'linkedin_structured_fallback');
  }
  return importResumeIntoDossier(deps, request, reply, body);
};

const handleGetResume: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  return { data: resumeStudioView(candidateStore, candidate.id), meta: { requestId: request.id } };
};

const handlePutResume: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const draft = resumeDraftSchema.parse(request.body);
  const saveResult = candidateStore.transaction(() => {
    const snapshot = candidateStore.getSnapshot(candidate.id);
    const storedDraft = snapshot.resume?.draft;
    // A stored v2 draft carries fields a pre-B265 client has never heard of.
    // Refuse it before any evidence materialization so stale clients cannot
    // silently erase fields or cause otherwise unrelated facts to be confirmed.
    if (storedDraft?.schemaVersion === 2 && draft.schemaVersion !== 2) {
      return { outdated: true } as const;
    }

    const boundDraft = materializeManualResumeEvidence(
      candidateStore,
      candidate.id,
      draft,
      storedDraft,
      new Set(snapshot.memory.map((memory) => memory.id)),
    );
    const evidence = candidateStore.getSnapshot(candidate.id).memory;
    const projection = buildResumeStudioProjection({ ...boundDraft, evidence });
    candidateStore.saveResumeDraft(candidate.id, boundDraft, projection.evidenceSnapshot);
    return { outdated: false } as const;
  });

  if (saveResult.outdated) {
    return sendError(
      reply,
      request,
      409,
      'resume_client_outdated',
      'Обновите приложение, чтобы сохранить резюме.',
      false,
    );
  }
  return { data: resumeStudioView(candidateStore, candidate.id), meta: { requestId: request.id } };
};

const handleSaveGermanyMarket: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const submission = germanyMarketSubmissionSchema.parse(request.body);
  const profile = candidateStore.saveGermanyMarket(
    candidate.id,
    submission,
    evaluateGermanyMarket(submission),
  );
  return { data: profile, meta: { requestId: request.id } };
};

/**
 * Часть файла. Целиком файл по маршруту владельца не доезжает — запрос уходит,
 * ответа нет (INC-031), — поэтому он приезжает частями и собирается здесь.
 */
async function registerCandidateLifecycle(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post(
    '/api/v1/candidates',
    {
      preHandler: previewAuth(deps.config.previewToken),
      config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    },
    withDeps(deps, handleCreateCandidate),
  );
  app.get('/api/v1/candidate/me', withDeps(deps, handleGetSnapshot));
  app.get('/api/v1/candidate/me/messages', withDeps(deps, handleGetMessages));
  app.get('/api/v1/candidate/me/turns', withDeps(deps, handleGetTurns));
  app.get('/api/v1/candidate/me/memory', withDeps(deps, handleGetMemory));
  app.delete('/api/v1/candidate/me', withDeps(deps, handleDeleteCandidate));
  app.get('/api/v1/candidate/export', withDeps(deps, handleExportCandidate));
  app.get('/api/v1/candidate/workspace', withDeps(deps, handleGetWorkspace));
  app.put(
    '/api/v1/candidate/workspace',
    {
      bodyLimit: 4 * 1_024 * 1_024,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    withDeps(deps, handlePutWorkspace),
  );
  app.patch('/api/v1/candidate/memory/:memoryId', withDeps(deps, handleChangeMemory));
  app.post(
    '/api/v1/candidate/memory/review',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    withDeps(deps, handleReviewMemories),
  );
  app.post(
    '/api/v1/candidate/assessments/:assessmentId',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    withDeps(deps, handleSaveAssessment),
  );
}

async function registerResumeEndpoints(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post(
    '/api/v1/candidate/parse-resume',
    {
      bodyLimit: 4 * 1_024 * 1_024,
      config: { rateLimit: { max: 30, timeWindow: '15 minutes' } },
    },
    withDeps(deps, handleParseResume),
  );
  app.post(
    '/api/v1/candidate/resume/import',
    {
      bodyLimit: 4 * 1_024 * 1_024,
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    withDeps(deps, handleImportResume),
  );
  app.post(
    '/api/v1/candidate/resume/import/structured',
    {
      bodyLimit: 512 * 1_024,
      config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
    },
    withDeps(deps, handleImportStructuredResume),
  );
  app.get('/api/v1/candidate/resume', withDeps(deps, handleGetResume));
  app.put(
    '/api/v1/candidate/resume',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    withDeps(deps, handlePutResume),
  );
  app.post(
    '/api/v1/candidate/markets/DE',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    withDeps(deps, handleSaveGermanyMarket),
  );
}

export async function registerCandidateRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  registerNotificationRoutes(app, deps);
  registerCandidateMediaRoutes(app, deps);
  await registerCandidateLifecycle(app, deps);
  await registerCandidateConsultantHistoryRoutes(app, deps);
  await registerCandidateExperienceFactRoutes(app, deps);
  await registerResumeEndpoints(app, deps);
  await registerCandidateResumeVersionRoutes(app, deps);
  registerCandidateDocumentRoutes(app, deps);
}
