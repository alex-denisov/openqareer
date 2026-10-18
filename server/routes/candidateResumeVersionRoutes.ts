import { createHmac } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  buildResumeAtsAssessment,
  type AtsRequirementSource,
  type ResumeAtsAssessment,
} from '../domain/resumeAtsAssessment';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from '../domain/resumeDraft';
import { buildResumeStudioProjection, buildTargetedResumeSlice } from '../domain/resumeStudio';
import { formatResumeAsAtsText, formatTargetedResumeAsAtsText } from '../domain/resumeAtsText';
import { estimateResumePages } from '../domain/resumeTargetedVolume';
import type {
  ResumeVersionContent,
  ResumeVersionCursor,
  ResumeVersionUpdateResult,
  StoredResumeVersion,
} from '../domain/resumeVersions';
import type { ResumeDocument, ResumeStudioProjection } from '../domain/resumeStudioTypes';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

const MAX_PAGE_SIZE = 50;
const versionIdSchema = z.string().uuid();
const requirementSchema = z.string().trim().min(1).max(160);
const createVersionSchema = z.object({
  title: z.string().trim().min(1).max(160),
  requirements: z.array(requirementSchema).min(1).max(50),
  expectedMasterRevision: z.string().min(1).max(128),
});
const updateVersionSchema = createVersionSchema.extend({
  expectedRevision: z.number().int().min(1),
  status: z.literal('approved').optional(),
});
const atsAssessmentSchema = z.object({
  title: z.string().trim().max(160).optional(),
  requirements: z.array(requirementSchema).max(50).optional(),
  versionId: versionIdSchema.optional(),
});
const versionQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
  cursor: z.string().max(512).optional(),
});
const cursorSchema = z.object({
  updatedAt: z.string().min(1).max(40),
  versionId: z.string().min(1).max(100),
});
const paramsSchema = z.object({ versionId: versionIdSchema });

interface CandidateResumeMaster {
  readonly draft: ResumeDraft;
  readonly document: ResumeDocument;
  readonly projection: ResumeStudioProjection;
  readonly updatedAt: string | null;
  readonly revision: string;
}

export async function registerCandidateResumeVersionRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  app.get('/api/v1/candidate/resume/versions', withDeps(deps, handleListResumeVersions));
  app.post(
    '/api/v1/candidate/resume/versions',
    {
      bodyLimit: 128 * 1_024,
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    withDeps(deps, handleCreateResumeVersion),
  );
  app.get('/api/v1/candidate/resume/versions/:versionId', withDeps(deps, handleGetResumeVersion));
  app.put(
    '/api/v1/candidate/resume/versions/:versionId',
    {
      bodyLimit: 128 * 1_024,
      config: { rateLimit: { max: 40, timeWindow: '1 minute' } },
    },
    withDeps(deps, handleUpdateResumeVersion),
  );
  app.post(
    '/api/v1/candidate/resume/ats-assessment',
    {
      bodyLimit: 128 * 1_024,
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    withDeps(deps, handleResumeAtsAssessment),
  );
}

function resumeVersionListItem(version: StoredResumeVersion) {
  return {
    id: version.id,
    title: version.title,
    status: version.status,
    revision: version.revision,
    sourceMasterRevision: version.sourceMasterRevision,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
  };
}

async function handleListResumeVersions(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;

  const query = versionQuerySchema.safeParse(request.query);
  if (!query.success) {
    return validationError(reply, request, 'invalid_resume_version_query', query.error);
  }
  const cursor = query.data.cursor ? decodeCursor(query.data.cursor) : null;
  if (query.data.cursor && !cursor) {
    return sendError(
      reply,
      request,
      400,
      'invalid_resume_version_cursor',
      'Некорректный курсор.',
      false,
    );
  }

  const master = currentMaster(deps, candidate.id);
  const page = deps.candidateStore.listResumeVersions(candidate.id, {
    limit: query.data.limit,
    cursor,
  });
  reply.header('Cache-Control', 'private, no-store');
  return {
    data: {
      items: page.items.map(resumeVersionListItem),
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
      totalCount: page.totalCount,
      currentMasterRevision: master.revision,
    },
    meta: { requestId: request.id },
  };
}

function replayIdempotentResumeVersion(
  deps: RouteDeps,
  candidateId: string,
  idempotencyKey: string,
  input: z.infer<typeof createVersionSchema>,
  request: FastifyRequest,
  reply: FastifyReply,
): unknown | null {
  const existing = deps.candidateStore.getResumeVersion(candidateId, idempotencyKey);
  if (!existing) return null;
  const sameRequest =
    existing.sourceMasterRevision === input.expectedMasterRevision &&
    existing.title === input.title &&
    sameStrings(existing.requirements, input.requirements);
  if (!sameRequest) {
    return sendError(
      reply,
      request,
      409,
      'resume_version_key_conflict',
      'Ключ запроса уже использован для другой версии резюме.',
      false,
    );
  }
  reply.header('Location', resumeVersionLocation(existing.id));
  reply.header('ETag', resumeVersionEtag(existing.id, existing.revision));
  reply.code(200);
  return {
    data: { version: existing, currentMasterRevision: currentMaster(deps, candidateId).revision },
    meta: { requestId: request.id },
  };
}

function createCandidateResumeVersion(
  deps: RouteDeps,
  candidateId: string,
  idempotencyKey: string,
  input: z.infer<typeof createVersionSchema>,
  request: FastifyRequest,
  reply: FastifyReply,
): unknown {
  const replay = replayIdempotentResumeVersion(
    deps,
    candidateId,
    idempotencyKey,
    input,
    request,
    reply,
  );
  if (replay !== null) return replay;

  const master = currentMaster(deps, candidateId);
  if (input.expectedMasterRevision !== master.revision) {
    return sourceChangedError(reply, request, master.revision);
  }
  const created = deps.candidateStore.createResumeVersion(
    candidateId,
    idempotencyKey,
    master.revision,
    buildVersionContent(master, input.title, input.requirements),
  );
  if (created.status === 'id_conflict') {
    return sendError(
      reply,
      request,
      409,
      'resume_version_key_conflict',
      'Ключ запроса уже использован для другой версии резюме.',
      false,
    );
  }
  reply.header('Location', resumeVersionLocation(created.version.id));
  reply.header('ETag', resumeVersionEtag(created.version.id, created.version.revision));
  reply.code(created.status === 'created' ? 201 : 200);
  return {
    data: { version: created.version, currentMasterRevision: master.revision },
    meta: { requestId: request.id },
  };
}

async function handleCreateResumeVersion(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;

  const body = createVersionSchema.safeParse(request.body);
  if (!body.success) {
    return validationError(reply, request, 'invalid_resume_version_input', body.error);
  }
  const idempotencyKey = idempotencyKeyOf(request);
  if (!idempotencyKey) {
    return sendError(
      reply,
      request,
      400,
      'idempotency_key_required',
      'Нужен заголовок Idempotency-Key с UUID запроса.',
      false,
    );
  }
  return createCandidateResumeVersion(
    deps,
    candidate.id,
    idempotencyKey,
    body.data,
    request,
    reply,
  );
}

async function handleGetResumeVersion(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const params = paramsSchema.safeParse(request.params);
  if (!params.success) {
    return validationError(reply, request, 'invalid_resume_version_id', params.error);
  }
  const version = deps.candidateStore.getResumeVersion(candidate.id, params.data.versionId);
  if (!version) {
    return sendError(
      reply,
      request,
      404,
      'resume_version_not_found',
      'Версия резюме не найдена.',
      false,
    );
  }
  const master = currentMaster(deps, candidate.id);
  reply.header('Cache-Control', 'private, no-store');
  reply.header('ETag', resumeVersionEtag(version.id, version.revision));
  return {
    data: { version, currentMasterRevision: master.revision },
    meta: { requestId: request.id },
  };
}

type ResumeVersionUpdateOutcome =
  | { readonly ok: true; readonly version: StoredResumeVersion }
  | { readonly ok: false; readonly response: FastifyReply };

function resumeVersionUpdateOutcome(
  result: ResumeVersionUpdateResult,
  request: FastifyRequest,
  reply: FastifyReply,
): ResumeVersionUpdateOutcome {
  if (result.status === 'updated') return { ok: true, version: result.version };
  if (result.status === 'not_found') {
    return {
      ok: false,
      response: sendError(
        reply,
        request,
        404,
        'resume_version_not_found',
        'Версия резюме не найдена.',
        false,
      ),
    };
  }
  if (result.status === 'immutable') {
    return {
      ok: false,
      response: sendError(
        reply,
        request,
        409,
        'resume_version_immutable',
        'Снимок в этом статусе нельзя изменить.',
        false,
      ),
    };
  }
  return {
    ok: false,
    response: sendError(
      reply,
      request,
      409,
      'resume_version_conflict',
      'Версия изменилась. Обновите её и повторите действие.',
      false,
    ),
  };
}

function resumeVersionApprovalConflict(
  existing: StoredResumeVersion,
  input: z.infer<typeof updateVersionSchema>,
  content: ResumeVersionContent,
  request: FastifyRequest,
  reply: FastifyReply,
): unknown | null {
  const unchangedReviewedSnapshot =
    existing.status === 'draft' &&
    existing.revision === input.expectedRevision &&
    existing.sourceMasterRevision === input.expectedMasterRevision &&
    existing.title === content.title &&
    canonicalJson(existing.requirements) === canonicalJson(content.requirements) &&
    canonicalJson(existing.snapshot) === canonicalJson(content.snapshot);
  if (unchangedReviewedSnapshot) return null;
  return sendError(
    reply,
    request,
    409,
    'resume_version_conflict',
    'Версия изменилась. Обновите её и повторите действие.',
    false,
  );
}

function updatedResumeVersionResponse(
  version: StoredResumeVersion,
  masterRevision: string,
  request: FastifyRequest,
  reply: FastifyReply,
): unknown {
  reply.header('ETag', resumeVersionEtag(version.id, version.revision));
  return {
    data: { version, currentMasterRevision: masterRevision },
    meta: { requestId: request.id },
  };
}

function updateCandidateResumeVersion(
  deps: RouteDeps,
  candidateId: string,
  input: z.infer<typeof updateVersionSchema>,
  versionId: string,
  request: FastifyRequest,
  reply: FastifyReply,
): unknown {
  const existing = deps.candidateStore.getResumeVersion(candidateId, versionId);
  if (!existing) {
    return sendError(
      reply,
      request,
      404,
      'resume_version_not_found',
      'Версия резюме не найдена.',
      false,
    );
  }
  const master = currentMaster(deps, candidateId);
  if (
    input.expectedMasterRevision !== master.revision ||
    existing.sourceMasterRevision !== master.revision
  ) {
    return sourceChangedError(reply, request, master.revision);
  }

  const content = buildVersionContent(
    master,
    input.title,
    input.requirements,
    input.status ?? 'draft',
  );
  if (input.status === 'approved') {
    const conflict = resumeVersionApprovalConflict(existing, input, content, request, reply);
    if (conflict !== null) return conflict;
  }

  const result = deps.candidateStore.updateResumeVersion(
    candidateId,
    existing.id,
    input.expectedRevision,
    master.revision,
    content,
  );
  const outcome = resumeVersionUpdateOutcome(result, request, reply);
  if (!outcome.ok) return outcome.response;
  return updatedResumeVersionResponse(outcome.version, master.revision, request, reply);
}

async function handleUpdateResumeVersion(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const params = paramsSchema.safeParse(request.params);
  if (!params.success) {
    return validationError(reply, request, 'invalid_resume_version_id', params.error);
  }
  const body = updateVersionSchema.safeParse(request.body);
  if (!body.success) {
    return validationError(reply, request, 'invalid_resume_version_input', body.error);
  }
  return updateCandidateResumeVersion(
    deps,
    candidate.id,
    body.data,
    params.data.versionId,
    request,
    reply,
  );
}

function assessTargetedResumeVersion(
  deps: RouteDeps,
  candidateId: string,
  versionId: string,
  evaluatedAt: string,
): ResumeAtsAssessment | null {
  const version = deps.candidateStore.getResumeVersion(candidateId, versionId);
  if (!version) return null;
  return buildResumeAtsAssessment({
    document: version.snapshot.document,
    atsText: formatTargetedResumeAsAtsText(version.snapshot),
    requirements: version.requirements,
    requirementSource: {
      kind: 'candidate_input',
      label: version.title,
      capturedAt: version.createdAt,
    },
    resumeUpdatedAt: null,
    resumeSourceRevision: version.sourceMasterRevision,
    evaluatedAt,
  });
}

function assessCandidateMasterResume(
  deps: RouteDeps,
  candidateId: string,
  input: z.infer<typeof atsAssessmentSchema>,
  evaluatedAt: string,
): ResumeAtsAssessment {
  const master = currentMaster(deps, candidateId);
  const requirements = input.requirements ?? [];
  const requirementSource: AtsRequirementSource | null =
    requirements.length > 0
      ? {
          kind: 'candidate_input',
          label: input.title?.trim() || 'Требования, указанные кандидатом',
          capturedAt: evaluatedAt,
        }
      : null;
  return buildResumeAtsAssessment({
    document: master.document,
    atsText: formatResumeAsAtsText(master.document, master.draft),
    requirements,
    requirementSource,
    resumeUpdatedAt: master.updatedAt,
    resumeSourceRevision: master.revision,
    evaluatedAt,
  });
}

function invalidVersionAssessmentRequest(
  reply: FastifyReply,
  request: FastifyRequest,
): FastifyReply {
  return sendError(
    reply,
    request,
    400,
    'invalid_ats_assessment_input',
    'Передайте либо версию резюме, либо требования для проверки.',
    false,
  );
}

async function handleResumeAtsAssessment(
  deps: RouteDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<unknown> {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const body = atsAssessmentSchema.safeParse(request.body ?? {});
  if (!body.success) {
    return validationError(reply, request, 'invalid_ats_assessment_input', body.error);
  }
  const evaluatedAt = new Date().toISOString();
  if (body.data.versionId) {
    if (body.data.title !== undefined || body.data.requirements !== undefined) {
      return invalidVersionAssessmentRequest(reply, request);
    }
    const assessment = assessTargetedResumeVersion(
      deps,
      candidate.id,
      body.data.versionId,
      evaluatedAt,
    );
    if (!assessment) {
      return sendError(
        reply,
        request,
        404,
        'resume_version_not_found',
        'Версия резюме не найдена.',
        false,
      );
    }
    return { data: { assessment }, meta: { requestId: request.id } };
  }
  const assessment = assessCandidateMasterResume(deps, candidate.id, body.data, evaluatedAt);
  return { data: { assessment }, meta: { requestId: request.id } };
}

function currentMaster(deps: RouteDeps, candidateId: string): CandidateResumeMaster {
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const stored = snapshot.resume;
  const draft = stored?.draft ?? EMPTY_RESUME_DRAFT;
  const projection = buildResumeStudioProjection({ ...draft, evidence: snapshot.memory });
  const revision = masterRevision(
    candidateId,
    draft,
    projection.evidenceSnapshot,
    deps.config.dataEncryptionKey,
  );
  return {
    draft,
    document: projection.master,
    projection,
    updatedAt: stored?.updatedAt ?? null,
    revision,
  };
}

function masterRevision(
  candidateId: string,
  draft: ResumeDraft,
  evidence: ResumeStudioProjection['evidenceSnapshot'],
  key: Buffer,
): string {
  const payload = canonicalJson({ draft, evidence });
  return createHmac('sha256', key)
    .update(candidateId)
    .update('\u0000')
    .update(payload)
    .digest('base64url');
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return (
      '{' +
      entries.map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item)).join(',') +
      '}'
    );
  }
  return JSON.stringify(value) ?? 'null';
}

function buildVersionContent(
  master: CandidateResumeMaster,
  title: string,
  requirements: readonly string[],
  status: 'draft' | 'approved' = 'draft',
): ResumeVersionContent {
  const slice = buildTargetedResumeSlice(master.document, { title, requirements });
  return {
    title: title.trim(),
    requirements: slice.requirements.map((item) => item.requirement),
    status,
    snapshot: estimateResumePages(slice),
  };
}

function validationError(
  reply: FastifyReply,
  request: FastifyRequest,
  code: string,
  error: z.ZodError,
): FastifyReply {
  const fields = Object.fromEntries(
    error.issues.map((issue) => [issue.path.join('.') || 'body', issue.message]),
  );
  return sendError(reply, request, 400, code, 'Проверьте введённые данные.', false, fields);
}

function idempotencyKeyOf(request: FastifyRequest): string | null {
  const value = request.headers['idempotency-key'];
  if (typeof value !== 'string') return null;
  const parsed = z.string().uuid().safeParse(value);
  return parsed.success ? parsed.data : null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function encodeCursor(cursor: ResumeVersionCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(value: string): ResumeVersionCursor | null {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}

function resumeVersionLocation(versionId: string): string {
  return '/api/v1/candidate/resume/versions/' + encodeURIComponent(versionId);
}

function resumeVersionEtag(versionId: string, revision: number): string {
  return '"resume-version-' + versionId + '-r' + revision + '"';
}

function sourceChangedError(
  reply: FastifyReply,
  request: FastifyRequest,
  currentMasterRevision: string,
): FastifyReply {
  return sendError(
    reply,
    request,
    409,
    'resume_source_changed',
    'Мастер-резюме изменилось. Обновите список версий и повторите действие.',
    false,
    undefined,
    { currentMasterRevision },
  );
}
