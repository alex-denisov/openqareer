import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  buildMemoryPage,
  buildMessagePage,
  buildSnapshotHead,
  buildTurnPage,
} from '../data/candidateSnapshotPage';
import { candidateWorkspaceSchema } from '../domain/candidateWorkspace';
import {
  evaluateProductCase,
  productCaseSubmissionSchema,
} from '../domain/assessment';
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
import { parseResumeContent } from '../../src/features/workspace/resumeParser';
import { normalizeResumeSourceText } from '../../src/features/workspace/resumeSourceText';
import type { CandidateStore } from '../data/candidateStore';
import { CandidateDocumentRetentionError } from '../data/sqliteCandidateStore';
import { buildDocumentTextPage } from '../data/documentTextPage';
import {
  CandidateDocumentValidationError,
  CandidateDocumentVersionError,
} from '../data/sqliteDocumentRepository';
import type { RouteDeps } from './deps';
import { nativeSourceConnectionView } from '../connectors/nativeSourceConnection';
import {
  authenticateCandidate,
  csrfError,
  encodeHeaderFileName,
  hasSafeMutationOrigin,
  previewAuth,
  sendError,
  withDeps,
} from './helpers';
import {
  assessmentIdSchema,
  candidateCreateSchema,
  candidateDocumentSchema,
  documentPartSchema,
  documentRetentionSchema,
  documentTextQuerySchema,
  memoryChangeSchema,
  memoryIdSchema,
  memoryReviewSchema,
  resumeImportSchema,
} from './schemas';

type Handler = (
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) => Promise<unknown>;

interface ResumeStudioView {
  draft: ResumeDraft | null;
  savedAt: { createdAt: string; updatedAt: string } | null;
  projection: ResumeStudioProjection;
  evidenceFreshness: ResumeEvidenceFreshness;
}

/**
 * Rebuilds both resume variants from the dossier as it stands now and compares
 * it with the evidence the candidate approved when the draft was saved, so a
 * revoked fact surfaces instead of surviving inside a generated document.
 */
function resumeStudioView(candidateStore: CandidateStore, candidateId: string): ResumeStudioView {
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
}> {
  // Both readers must see the same document. The model was handed the raw
  // extraction while only the rules parser repaired it, so on an hh.ru export
  // the model read `Проживает : Москва`, echoed the spacing into every title and
  // lost the fields the rules parser had already found (B178).
  const source = normalizeResumeSourceText(text);
  const deterministic = parseResumeContent(source);
  if (!structurer) return { resume: deterministic, structuredBy: 'rules' };
  // Модель — улучшение, а не условие: без потолка кандидат ждал её отказа
  // шесть с половиной минут (INC-037).
  const structured = await structureWithinBudget(source, structurer);
  if (!structured) return { resume: deterministic, structuredBy: 'rules' };
  return {
    resume: preferStructuredResume(structured, deterministic),
    structuredBy: 'model',
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
});

const messagesQuerySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
});

const handleGetSnapshot: Handler = async ({ authService, candidateStore, config }, request, reply) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const { memoryOffset } = snapshotQuerySchema.parse(request.query);
  // Целиком снимок до браузера не доезжает — маршрут рвёт ответ примерно на
  // 20 460 байт (INC-030). Экран получает голову снимка и дочитывает память.
  const { data, meta } = buildSnapshotHead(candidateStore.getSnapshot(candidate.id), memoryOffset);
  return { data, meta: { requestId: request.id, ...meta } };
};

/** Память страницами: голова снимка её не несёт (INC-030). */
const handleGetMemory: Handler = async ({ authService, candidateStore, config }, request, reply) => {
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
  const { offset } = messagesQuerySchema.parse(request.query);
  const page = buildMessagePage(candidateStore.getSnapshot(candidate.id).messages, offset);
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
  const { authService, candidateStore, candidateReputationRepo, recruiterContactsRepo, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  candidateStore.deleteCandidate(candidate.id);
  candidateReputationRepo?.deleteAuditsByCandidateId(candidate.id);
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
      reputationAudits: candidateReputationRepo?.listAudits(candidate.id, { trustedOnly: true }) ?? [],
      // Keep the singular key for clients that have not migrated yet.
      reputationAudit: candidateReputationRepo?.getLatestAudit(candidate.id, { trustedOnly: true }) ?? null,
    },
    meta: { requestId: request.id, exportedAt: new Date().toISOString() },
  };
};

const handleGetWorkspace: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  return {
    data: candidateStore.getCandidateWorkspace(candidate.id),
    meta: { requestId: request.id },
  };
};

/**
 * The wizard's answers are the candidate's own words; no engine can recompute
 * them. Keeping them only in browser storage meant signing out erased the
 * candidate's career context (INC-024).
 */
const handlePutWorkspace: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = z
    .object({ workspace: candidateWorkspaceSchema })
    .strict()
    .parse(request.body);
  return {
    data: candidateStore.saveCandidateWorkspace(candidate.id, body.workspace),
    meta: { requestId: request.id },
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

  const parsed = await readResume(body.text, deps.resumeStructurer);
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
  const replay = nativeResumeImportReplay(candidateStore, candidate.id, body);
  if (replay) {
    return { data: replay, meta: { requestId: request.id, idempotentReplay: true } };
  }
  const read = await readResume(body.text, deps.resumeStructurer);
  const plan = planResumeImport(read.resume, {
    idPrefix: newImportMemoryIdPrefix(randomUUID()),
  });
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
  const committed = candidateStore.commitResumeImport(
    candidate.id,
    resumeImportCommit(candidate.id, body, plan),
  );
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
) {
  return {
    evidence: {
      sourceLabel: resumeImportLabel(body.source, body.fileName),
      sourceDigest: resumeDocumentDigest(candidateId, body.source, body.text),
      entries: plan.evidence.map((item) => ({
        memoryId: item.memoryId,
        domain: item.domain,
        statement: item.statement,
      })),
    },
    draft: plan.draft,
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
  // A stored v2 draft carries fields a pre-B265 client has never heard of.
  // Saving that client's payload as-is would silently drop them, so an old
  // build is refused outright instead of quietly losing data (architecture §1).
  const storedDraft = candidateStore.getSnapshot(candidate.id).resume?.draft;
  if (storedDraft?.schemaVersion === 2 && draft.schemaVersion !== 2) {
    return sendError(
      reply,
      request,
      409,
      'resume_client_outdated',
      'Обновите приложение, чтобы сохранить резюме.',
      false,
    );
  }
  const projection = buildResumeStudioProjection({
    ...draft,
    evidence: candidateStore.getSnapshot(candidate.id).memory,
  });
  candidateStore.saveResumeDraft(candidate.id, draft, projection.evidenceSnapshot);
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
const handleDocumentPart: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, uploadStaging } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = documentPartSchema.parse(request.body);
  try {
    const state = uploadStaging.accept(candidate.id, body);
    return { data: state, meta: { requestId: request.id } };
  } catch (error) {
    return sendError(
      reply,
      request,
      400,
      'document_upload_part_rejected',
      error instanceof Error ? error.message : 'Часть файла не принята.',
      false,
    );
  }
};

const handleSaveDocument: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config, uploadStaging } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const body = candidateDocumentSchema.parse(request.body);
  const contentBase64 = body.uploadId
    ? uploadStaging.take(candidate.id, body.uploadId)
    : body.contentBase64;
  if (!contentBase64) {
    return sendError(
      reply,
      request,
      409,
      'document_upload_incomplete',
      'Загрузка не собрана: часть файла не дошла. Повторите отправку.',
      true,
    );
  }
  try {
    const stored = candidateStore.saveDocument(candidate.id, { ...body, contentBase64 });
    return reply.code(stored.created ? 201 : 200).send({
      data: stored,
      meta: { requestId: request.id },
    });
  } catch (error) {
    if (error instanceof CandidateDocumentValidationError) {
      return sendError(
        reply,
        request,
        400,
        'document_invalid',
        'Файл не прошёл проверку формата или размера.',
        false,
      );
    }
    if (error instanceof CandidateDocumentVersionError) {
      return sendError(
        reply,
        request,
        409,
        'document_version_conflict',
        'Предыдущая версия документа недоступна.',
        false,
      );
    }
    throw error;
  }
};

function loadCandidateDocument(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { authService, candidateStore, config } = deps;
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return null;
  const documentId = z.string().uuid().parse((request.params as { documentId: string }).documentId);
  const document = candidateStore.getDocument(candidate.id, documentId);
  if (!document) {
    sendError(reply, request, 404, 'document_not_found', 'Документ не найден.', false);
    return null;
  }
  return document;
}

const handleGetDocument: Handler = async (deps, request, _reply) => {
  const document = loadCandidateDocument(deps, request, _reply);
  if (!document) return undefined;
  // Целиком запись до клиента не доезжает: маршрут рвал ответ на 20 469 байтах
  // и обрывал `extractedText` на середине строки (INC-034). Карточка везёт
  // поля документа и длину текста; байты файла отдаёт `/download`, а текст —
  // своя страница.
  const { contentBase64, extractedText, ...card } = document;
  return {
    data: { ...card, textLength: extractedText?.length ?? 0 },
    meta: { requestId: request.id },
  };
};

const handleGetDocumentText: Handler = async (deps, request, reply) => {
  const document = loadCandidateDocument(deps, request, reply);
  if (!document) return undefined;
  const { offset } = documentTextQuerySchema.parse(request.query ?? {});
  // Reserve the exact worst-case JSON envelope, including request id and offsets.
  const text = document.extractedText ?? '';
  const envelopeBytes = Buffer.byteLength(JSON.stringify({
    data: { text: '' },
    meta: { requestId: request.id, offset, nextOffset: text.length, length: text.length },
  }), 'utf8') + 4; // null may be wider than a short numeric nextOffset
  const page = buildDocumentTextPage(text, offset, 12_288 - envelopeBytes);
  return {
    data: { text: page.text },
    meta: {
      requestId: request.id,
      offset: page.offset,
      nextOffset: page.nextOffset,
      length: page.length,
    },
  };
};

const handleDownloadDocument: Handler = async (deps, request, reply) => {
  const document = loadCandidateDocument(deps, request, reply);
  if (!document) return undefined;
  reply.header('Cache-Control', 'private, no-store');
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header(
    'Content-Disposition',
    `attachment; filename="openqareer-document"; filename*=UTF-8''${encodeHeaderFileName(document.fileName)}`,
  );
  return reply.type(document.mimeType).send(Buffer.from(document.contentBase64, 'base64'));
};

const handleSetRetention: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const documentId = z.string().uuid().parse((request.params as { documentId: string }).documentId);
  const body = documentRetentionSchema.parse(request.body);
  try {
    const document = candidateStore.setDocumentRetention(
      candidate.id,
      documentId,
      body.retentionUntil,
      new Date().toISOString(),
    );
    if (!document) {
      return sendError(reply, request, 404, 'document_not_found', 'Документ не найден.', false);
    }
    return { data: document, meta: { requestId: request.id } };
  } catch (error) {
    if (error instanceof CandidateDocumentRetentionError) {
      return sendError(
        reply,
        request,
        422,
        'document_retention_invalid',
        'Срок хранения должен быть в будущем и не дальше десяти лет.',
        false,
      );
    }
    throw error;
  }
};

const handleDeleteDocument: Handler = async (deps, request, reply) => {
  const { authService, candidateStore, config } = deps;
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const documentId = z.string().uuid().parse((request.params as { documentId: string }).documentId);
  if (!candidateStore.deleteDocument(candidate.id, documentId)) {
    return sendError(reply, request, 404, 'document_not_found', 'Документ не найден.', false);
  }
  return reply.code(204).send();
};

async function registerCandidateLifecycle(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
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

async function registerDocumentEndpoints(app: FastifyInstance, deps: RouteDeps): Promise<void> {
  app.post(
    '/api/v1/candidate/documents/parts',
    {
      bodyLimit: 64 * 1_024,
      config: { rateLimit: { max: 2_000, timeWindow: '1 hour' } },
    },
    withDeps(deps, handleDocumentPart),
  );
  app.post(
    '/api/v1/candidate/documents',
    {
      bodyLimit: 8 * 1_024 * 1_024,
      config: { rateLimit: { max: 20, timeWindow: '1 hour' } },
    },
    withDeps(deps, handleSaveDocument),
  );
  app.get('/api/v1/candidate/documents/:documentId', withDeps(deps, handleGetDocument));
  app.get('/api/v1/candidate/documents/:documentId/text', withDeps(deps, handleGetDocumentText));
  app.get(
    '/api/v1/candidate/documents/:documentId/download',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    withDeps(deps, handleDownloadDocument),
  );
  app.patch(
    '/api/v1/candidate/documents/:documentId/retention',
    { config: { rateLimit: { max: 20, timeWindow: '1 hour' } } },
    withDeps(deps, handleSetRetention),
  );
  app.delete('/api/v1/candidate/documents/:documentId', withDeps(deps, handleDeleteDocument));
}

export async function registerCandidateRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  await registerCandidateLifecycle(app, deps);
  await registerResumeEndpoints(app, deps);
  await registerDocumentEndpoints(app, deps);
}
