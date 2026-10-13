import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';
import {
  RELOCATION_CONSENT_STATUS,
  RELOCATION_CONSENT_TEXT_APPROVED,
  RELOCATION_CONSENT_VERSION,
  RELOCATION_STEPS,
  emptyRelocationQuestionnaire,
  relocationAlerts,
  relocationQuestionnaireStepSchemas,
  relocationProgressSchema,
  type CitizenshipDocumentsStep,
  type EducationStep,
  type FamilyStep,
  type LanguagesStep,
  type RelocationLanguageStepInput,
  type RelocationStepId,
  relocationLanguageStepInputSchema,
} from '../../shared/relocationQuestionnaire';
import type { RouteDeps } from './deps';
import type { CandidateStore, LinkedInLanguageImportSnapshot } from '../data/candidateStore';
import {
  authenticateCandidate,
  csrfError,
  fieldMessages,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import {
  RelocationConsentRequiredError,
  RelocationProfileRevisionConflictError,
  RelocationQuestionnaireStorageError,
} from '../data/sqliteRelocationQuestionnaireRepository';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

type ParsedStep =
  | { readonly step: 'citizenship_documents'; readonly data: CitizenshipDocumentsStep }
  | { readonly step: 'education'; readonly data: EducationStep }
  | { readonly step: 'family'; readonly data: FamilyStep }
  | { readonly step: 'languages'; readonly data: RelocationLanguageStepInput };

const consentInputSchema = z.object({ versionId: z.string().trim().min(1).max(80) }).strict();
const importInputSchema = z.object({}).strict();

const handleGet: Handler = async ({ authService, candidateStore, config }, request, reply) => {
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  try {
    const consent = candidateStore.relocationQuestionnaireRepo.getConsent(candidate.id);
    const profile = consent.granted
      ? (candidateStore.relocationQuestionnaireRepo.getProfile(candidate.id) ??
        emptyRelocationQuestionnaire())
      : null;
    reply.header('Cache-Control', 'private, no-store');
    if (profile) reply.header('ETag', etag(profile.revision));
    return {
      data: {
        profile,
        consent,
        consentTextStatus: RELOCATION_CONSENT_STATUS,
        alerts: profile ? relocationAlerts(profile, new Date().toISOString().slice(0, 10)) : [],
      },
      meta: { requestId: request.id },
    };
  } catch (error) {
    return handleRepositoryError(error, request, reply);
  }
};

const handlePutConsent: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const parsed = consentInputSchema.safeParse(request.body);
  if (!parsed.success)
    return sendError(
      reply,
      request,
      400,
      'invalid_relocation_consent',
      'Проверьте версию согласия.',
      false,
      fieldMessages(parsed.error),
    );
  if (parsed.data.versionId !== RELOCATION_CONSENT_VERSION)
    return sendError(
      reply,
      request,
      409,
      'invalid_relocation_consent_version',
      'Версия согласия устарела.',
      false,
    );
  if (!RELOCATION_CONSENT_TEXT_APPROVED)
    return sendError(
      reply,
      request,
      409,
      'relocation_consent_text_not_approved',
      'Текст согласия ожидает проверки и пока не может быть принят.',
      false,
    );
  try {
    const consent = candidateStore.relocationQuestionnaireRepo.grantConsent(
      candidate.id,
      parsed.data.versionId,
      new Date().toISOString(),
    );
    return { data: { consent }, meta: { requestId: request.id } };
  } catch (error) {
    return handleRepositoryError(error, request, reply);
  }
};

const handleDeleteConsent: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  try {
    const wasGranted = candidateStore.relocationQuestionnaireRepo.getConsent(candidate.id).granted;
    const consent = candidateStore.relocationQuestionnaireRepo.revokeConsent(
      candidate.id,
      new Date().toISOString(),
    );
    return {
      data: { consent, revoked: wasGranted, deleted: true },
      meta: { requestId: request.id },
    };
  } catch (error) {
    return handleRepositoryError(error, request, reply);
  }
};

const handlePutStep: Handler = async ({ authService, candidateStore, config }, request, reply) => {
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const revision = readIfMatch(request, reply);
  if (revision === null) return undefined;
  const stepId = readStepId(request, reply);
  if (!stepId) return undefined;
  const parsed = parseStep(stepId, request.body);
  if (!parsed)
    return sendError(
      reply,
      request,
      400,
      'invalid_relocation_step',
      'Проверьте поля шага анкеты.',
      false,
    );
  return saveStep(candidateStore, candidate.id, parsed, revision, request, reply);
};

const handlePutProgress: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const revision = readIfMatch(request, reply);
  if (revision === null) return undefined;
  const parsed = relocationProgressSchema.safeParse(request.body);
  if (!parsed.success)
    return sendError(
      reply,
      request,
      400,
      'invalid_relocation_progress',
      'Проверьте текущий шаг анкеты.',
      false,
      fieldMessages(parsed.error),
    );
  try {
    const profile = candidateStore.relocationQuestionnaireRepo.putProgress(
      candidate.id,
      parsed.data,
      revision,
      new Date().toISOString(),
    );
    reply.header('ETag', etag(profile.revision));
    return profileResponse(profile, request);
  } catch (error) {
    return handleRepositoryError(error, request, reply);
  }
};

const handleDeleteQuestionnaire: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const revision = readIfMatch(request, reply);
  if (revision === null) return undefined;
  try {
    candidateStore.relocationQuestionnaireRepo.deleteProfile(candidate.id, revision);
    return reply.code(204).send();
  } catch (error) {
    return handleRepositoryError(error, request, reply);
  }
};

const handleImportLinkedInLanguages: Handler = async (
  { authService, candidateStore, config },
  request,
  reply,
) => {
  if (!hasSafeMutationOrigin(request, config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(request, reply, candidateStore, authService, config);
  if (!candidate) return undefined;
  const revision = readIfMatch(request, reply);
  if (revision === null) return undefined;
  if (!importInputSchema.safeParse(request.body ?? {}).success)
    return sendError(
      reply,
      request,
      400,
      'invalid_linkedin_language_import',
      'Не удалось прочитать запрос импорта.',
      false,
    );
  let source: LinkedInLanguageImportSnapshot | null;
  try {
    source = candidateStore.getLinkedInLanguageImport(candidate.id);
  } catch (error) {
    return handleRepositoryError(error, request, reply);
  }
  if (!source)
    return sendError(
      reply,
      request,
      409,
      'linkedin_languages_unavailable',
      'Сначала импортируйте профиль LinkedIn с языками.',
      false,
    );
  return saveLinkedInLanguages(candidateStore, candidate.id, source, revision, request, reply);
};

export function registerRelocationQuestionnaireRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const readLimit = { config: { rateLimit: { max: 120, timeWindow: '1 hour' } } };
  const writeLimit = { config: { rateLimit: { max: 60, timeWindow: '1 hour' } } };
  app.get('/api/v1/candidate/relocation-questionnaire', readLimit, withDeps(deps, handleGet));
  app.put(
    '/api/v1/candidate/relocation-questionnaire/consent',
    writeLimit,
    withDeps(deps, handlePutConsent),
  );
  app.delete(
    '/api/v1/candidate/relocation-questionnaire/consent',
    writeLimit,
    withDeps(deps, handleDeleteConsent),
  );
  app.put(
    '/api/v1/candidate/relocation-questionnaire/steps/:stepId',
    writeLimit,
    withDeps(deps, handlePutStep),
  );
  app.put(
    '/api/v1/candidate/relocation-questionnaire/progress',
    writeLimit,
    withDeps(deps, handlePutProgress),
  );
  app.put(
    '/api/v1/candidate/relocation-questionnaire/languages/linkedin',
    writeLimit,
    withDeps(deps, handleImportLinkedInLanguages),
  );
  app.delete(
    '/api/v1/candidate/relocation-questionnaire',
    writeLimit,
    withDeps(deps, handleDeleteQuestionnaire),
  );
}

function parseStep(step: RelocationStepId, value: unknown): ParsedStep | null {
  if (step === 'citizenship_documents') {
    const parsed = relocationQuestionnaireStepSchemas.citizenship_documents.safeParse(value);
    return parsed.success ? { step, data: parsed.data } : null;
  }
  if (step === 'education') {
    const parsed = relocationQuestionnaireStepSchemas.education.safeParse(value);
    return parsed.success ? { step, data: parsed.data } : null;
  }
  if (step === 'family') {
    const parsed = relocationQuestionnaireStepSchemas.family.safeParse(value);
    return parsed.success ? { step, data: parsed.data } : null;
  }
  const parsed = relocationLanguageStepInputSchema.safeParse(value);
  return parsed.success ? { step, data: parsed.data } : null;
}

function readStepId(request: FastifyRequest, reply: FastifyReply): RelocationStepId | null {
  const stepId = (request.params as { stepId?: string }).stepId;
  if (stepId && (RELOCATION_STEPS as readonly string[]).includes(stepId))
    return stepId as RelocationStepId;
  sendError(reply, request, 404, 'unknown_relocation_step', 'Такого шага анкеты нет.', false);
  return null;
}

function readIfMatch(request: FastifyRequest, reply: FastifyReply): number | null {
  const value = request.headers['if-match'];
  if (!value) {
    sendError(
      reply,
      request,
      428,
      'if_match_required',
      'Обновите анкету перед сохранением.',
      false,
    );
    return null;
  }
  const match = /^"(0|[1-9]\d*)"$/u.exec(value);
  if (!match) {
    sendError(
      reply,
      request,
      400,
      'invalid_if_match',
      'Версия анкеты имеет неверный формат.',
      false,
    );
    return null;
  }
  return Number(match[1]);
}

function saveStep(
  candidateStore: CandidateStore,
  candidateId: string,
  parsed: ParsedStep,
  revision: number,
  request: FastifyRequest,
  reply: FastifyReply,
): unknown {
  try {
    const profile = saveStepData(candidateStore, candidateId, parsed, revision);
    reply.header('ETag', etag(profile.revision));
    return profileResponse(profile, request);
  } catch (error) {
    return handleRepositoryError(error, request, reply);
  }
}

function saveStepData(
  candidateStore: CandidateStore,
  candidateId: string,
  parsed: ParsedStep,
  revision: number,
) {
  const now = new Date().toISOString();
  if (parsed.step === 'citizenship_documents')
    return candidateStore.relocationQuestionnaireRepo.putStep(
      candidateId,
      parsed.step,
      parsed.data,
      revision,
      now,
    );
  if (parsed.step === 'education')
    return candidateStore.relocationQuestionnaireRepo.putStep(
      candidateId,
      parsed.step,
      parsed.data,
      revision,
      now,
    );
  if (parsed.step === 'family')
    return candidateStore.relocationQuestionnaireRepo.putStep(
      candidateId,
      parsed.step,
      parsed.data,
      revision,
      now,
    );
  const languages = preserveLanguageSources(candidateStore, candidateId, parsed.data);
  return candidateStore.relocationQuestionnaireRepo.putStep(
    candidateId,
    'languages',
    languages,
    revision,
    now,
  );
}

function preserveLanguageSources(
  candidateStore: CandidateStore,
  candidateId: string,
  input: RelocationLanguageStepInput,
): LanguagesStep {
  const current =
    candidateStore.relocationQuestionnaireRepo.getProfile(candidateId) ??
    emptyRelocationQuestionnaire();
  const existing = new Map(current.languages.languages.map((language) => [language.id, language]));
  const languages = input.languages.map((language) => {
    const previous = existing.get(language.id);
    if (!previous || previous.name !== language.name || previous.level !== language.level) {
      return { ...language, source: 'candidate' as const };
    }
    return { ...previous, confirmation: language.confirmation };
  });
  return { languages };
}

function saveLinkedInLanguages(
  candidateStore: CandidateStore,
  candidateId: string,
  source: LinkedInLanguageImportSnapshot,
  revision: number,
  request: FastifyRequest,
  reply: FastifyReply,
): unknown {
  const languages = mapLinkedInLanguages(source.languages, source.capturedAt);
  if (languages.length === 0)
    return sendError(
      reply,
      request,
      409,
      'linkedin_languages_unavailable',
      'В импортированном профиле нет распознанных языков.',
      false,
    );
  try {
    const profile =
      candidateStore.relocationQuestionnaireRepo.getProfile(candidateId) ??
      emptyRelocationQuestionnaire();
    const updated = candidateStore.relocationQuestionnaireRepo.putStep(
      candidateId,
      'languages',
      { languages: mergeImportedLanguages(profile.languages.languages, languages) },
      revision,
      new Date().toISOString(),
    );
    reply.header('ETag', etag(updated.revision));
    return {
      data: {
        profile: updated,
        importedCount: languages.length,
        source: 'linkedin',
        capturedAt: source.capturedAt,
      },
      meta: { requestId: request.id },
    };
  } catch (error) {
    return handleRepositoryError(error, request, reply);
  }
}

function mapLinkedInLanguages(
  languages: readonly {
    readonly evidenceMemoryId: string;
    readonly name?: string;
    readonly cefr?: string;
    readonly sourceLabel?: string;
  }[],
  capturedAt: string,
): LanguagesStep['languages'][number][] {
  const rows = languages.flatMap((language) => {
    const name = language.name?.trim();
    if (!name) return [];
    const digest = createHash('sha256')
      .update(language.evidenceMemoryId)
      .digest('hex')
      .slice(0, 32);
    return [
      {
        id: `linkedin_${digest}`,
        name,
        level: isCefr(language.cefr) ? language.cefr : ('unknown' as const),
        source: 'linkedin' as const,
        sourceCapturedAt: capturedAt,
        ...(language.sourceLabel ? { sourceLabel: language.sourceLabel.slice(0, 160) } : {}),
        confirmation: 'proposed' as const,
      },
    ];
  });
  return rows.slice(0, 30);
}

function mergeImportedLanguages(
  current: LanguagesStep['languages'],
  incoming: LanguagesStep['languages'],
): LanguagesStep['languages'] {
  const userRows = current.filter((language) => language.source !== 'linkedin');
  const names = new Set(userRows.map(({ name }) => normalizeLanguageName(name)));
  const imported = incoming.filter(({ name }) => {
    const normalized = normalizeLanguageName(name);
    if (names.has(normalized)) return false;
    names.add(normalized);
    return true;
  });
  return [...userRows, ...imported].slice(0, 30);
}

function normalizeLanguageName(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('ru-RU').replace(/\s+/gu, ' ');
}

function isCefr(
  value: string | undefined,
): value is Exclude<LanguagesStep['languages'][number]['level'], 'unknown'> {
  return ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].includes(value ?? '');
}

function profileResponse(
  profile: import('../../shared/relocationQuestionnaire').RelocationQuestionnaire,
  request: FastifyRequest,
) {
  return {
    data: { profile, alerts: relocationAlerts(profile, new Date().toISOString().slice(0, 10)) },
    meta: { requestId: request.id },
  };
}

function handleRepositoryError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  if (error instanceof RelocationConsentRequiredError) return consentRequiredError(request, reply);
  if (error instanceof RelocationProfileRevisionConflictError)
    return profileRevisionError(error, request, reply);
  if (error instanceof ZodError) return invalidRelocationStepError(error, request, reply);
  return profileUnavailableError(
    error,
    request,
    reply,
    error instanceof RelocationQuestionnaireStorageError,
  );
}

function consentRequiredError(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  return sendError(
    reply,
    request,
    409,
    'relocation_consent_required',
    'Сначала предоставьте отдельное согласие на анкету релокации.',
    false,
  );
}

function profileRevisionError(
  error: RelocationProfileRevisionConflictError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  return sendError(
    reply,
    request,
    412,
    'relocation_profile_revision_conflict',
    'Анкета изменилась. Загрузите актуальную версию.',
    false,
    undefined,
    { currentRevision: error.currentRevision },
  );
}

function invalidRelocationStepError(
  error: ZodError,
  request: FastifyRequest,
  reply: FastifyReply,
): FastifyReply {
  return sendError(
    reply,
    request,
    400,
    'invalid_relocation_step',
    'Проверьте поля шага анкеты.',
    false,
    fieldMessages(error),
  );
}

function profileUnavailableError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
  isReadFailure: boolean,
): FastifyReply {
  request.log.error(
    { requestId: request.id, errorType: error instanceof Error ? error.name : 'UnknownError' },
    'relocation questionnaire storage operation failed',
  );
  const message = isReadFailure ? 'Не удалось прочитать анкету.' : 'Не удалось сохранить анкету.';
  return sendError(reply, request, 500, 'relocation_profile_unavailable', message, true);
}

function etag(revision: number): string {
  return `"${revision}"`;
}
