import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { HhResumeEdit } from '../../shared/hhCandidateSession';
import { MAX_TEXT_VARIANTS } from '../../shared/textVariants';
import { SqliteHhSessionRepository } from '../candidate/sqliteHhSessionRepository';
import { SqliteTextVariantRepository, type TextSubject } from '../candidate/sqliteTextVariantRepository';
import { writeCheckedVariant } from '../domain/checkedVariant';
import { hhResumeLanguage } from '../domain/hhResumeEdits';
import { checkHhResumeVariant, hhResumeVariantRequest, type HhResumeVariantRequest } from '../domain/hhResumeVariant';
import { normalizeWish } from '../domain/textVariants';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { resolvePoolVacancyCluster } from '../vacancies/poolVacancyCluster';
import type { RouteDeps } from './deps';
import { sendError } from './helpers';
import { resumesForVacancy } from './hhVacancyResume';
import { hhEditsInput, selectedWithSections, type SelectedWithSections } from './hhResumeEditsInput';
import { hhCandidateOf, hhResumeEditsOf, withVariantSubjects } from './hhSessionRoutes';
import { currentMaster } from './resumeMaster';
import { generationFailed, limitReached } from './textVariantRoutes';

const VARIANT_LIMIT = { config: { rateLimit: { max: 30, timeWindow: '1 hour' } } };
/** Неудачных вызовов модели на кандидата за час: удачные и так ограничены тремя вариантами (как у LinkedIn, B692). */
const FAILURES_MAX = 5;
const HOUR_MS = 60 * 60 * 1000;
const bodySchema = z
  .object({ vacancyId: z.string().trim().min(1).max(512), subjectId: z.string().regex(/^[0-9a-f]{64}$/u) })
  .strict();

interface Stores {
  readonly hh: SqliteHhSessionRepository;
  readonly variants: SqliteTextVariantRepository;
}

interface Source {
  readonly resume: SelectedWithSections;
  readonly cluster: VacancyCluster;
}

function sourceOf(
  deps: RouteDeps, stores: Stores, request: FastifyRequest, reply: FastifyReply, candidateId: string, vacancyId: string,
): Source | null {
  const snapshot = stores.hh.getSnapshot(candidateId);
  const resume = selectedWithSections(snapshot && resumesForVacancy(deps, snapshot, vacancyId));
  if (!resume) {
    sendError(reply, request, 409, 'hh_resume_sections_missing', 'Выберите резюме hh.ru ещё раз: его разделы не прочитаны.', false);
    return null;
  }
  const cluster = resolvePoolVacancyCluster(deps.multiSourceEngine, vacancyId);
  if (cluster) return { resume, cluster };
  sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
  return null;
}

function variantRequest(
  deps: RouteDeps, stores: Stores, subject: TextSubject, source: Source, edit: HhResumeEdit, vacancyId: string,
): HhResumeVariantRequest | null {
  const { platform, vacancy } = hhEditsInput(deps, subject.candidateId, source.resume, source.cluster, vacancyId);
  return hhResumeVariantRequest({
    edit,
    language: hhResumeLanguage(source.resume.sections),
    vacancyTitle: vacancy.title,
    resumeSkills: source.resume.sections.skills,
    profileSkills: (currentMaster(deps, subject.candidateId).document.skills ?? []).map((skill) => skill.name),
    profileFacts: platform.facts,
    avoid: [edit.now, ...stores.variants.list(subject).variants.map((variant) => variant.text)],
  });
}

async function writeVariant(
  deps: RouteDeps, stores: Stores, request: FastifyRequest, reply: FastifyReply,
  subject: TextSubject, vacancyId: string, source: Source,
) {
  const { candidateId } = subject;
  const edits = withVariantSubjects(
    deps, candidateId, source.resume, source.cluster, vacancyId,
    await hhResumeEditsOf(deps, candidateId, source.resume, source.cluster, vacancyId),
  );
  const edit = edits.find((item) => item.variantOf?.subjectId === subject.subjectId);
  const input = edit ? variantRequest(deps, stores, subject, source, edit, vacancyId) : null;
  if (!input) return sendError(reply, request, 404, 'hh_edit_not_found', 'Такой правки больше нет. Откройте разбор заново.', false);
  const checked = await writeCheckedVariant({
    request: input,
    write: async (asked) => deps.experienceFactRewriter?.hhResumeVariant?.(asked),
    check: (output, onReject) => checkHhResumeVariant(input, output, onReject),
    onReject: (reason, attempt) => request.log.info({ section: input.target, reason, attempt }, 'hh_resume_variant_rejected'),
  });
  if (!checked) return generationFailed(reply, request);
  const variant = stores.variants.add({
    ...subject,
    text: checked.text,
    wish: normalizeWish(undefined),
    payload: { vacancyId, ...(checked.added ? { added: checked.added } : {}) },
    createdAt: new Date().toISOString(),
  });
  if (!variant) return limitReached(reply, request);
  return reply.code(201).send({ data: { variant, ...stores.variants.list(subject) }, meta: { requestId: request.id } });
}

function failureLog() {
  const failures = new Map<string, readonly number[]>();
  const recent = (candidateId: string) => (failures.get(candidateId) ?? []).filter((at) => Date.now() - at < HOUR_MS);
  return {
    exhausted: (candidateId: string) => recent(candidateId).length >= FAILURES_MAX,
    add: (candidateId: string) => void failures.set(candidateId, [...recent(candidateId), Date.now()]),
  };
}

function register(app: FastifyInstance, deps: RouteDeps, stores: Stores): void {
  // Один вариант на правку за раз: параллельные запросы не обходят предел лишними вызовами модели.
  const inFlight = new Set<string>();
  const failures = failureLog();
  app.post('/api/v1/candidate/hh/resumes/edits/variants', VARIANT_LIMIT, async (request, reply) => {
    const candidateId = hhCandidateOf(deps, request, reply);
    if (!candidateId) return reply;
    const body = bodySchema.safeParse(request.body ?? {});
    if (!body.success) return sendError(reply, request, 400, 'invalid_variant_request', 'Проверьте правку.', false);
    const { vacancyId, subjectId } = body.data;
    const subject = { candidateId, kind: 'resume' as const, subjectId };
    if (stores.variants.count(subject) >= MAX_TEXT_VARIANTS) return limitReached(reply, request);
    if (failures.exhausted(candidateId)) {
      return sendError(reply, request, 429, 'variant_attempts_exhausted', 'Другой вариант не собрался. Попробуйте позже.', true);
    }
    const source = sourceOf(deps, stores, request, reply, candidateId, vacancyId);
    if (!source) return reply;
    const flight = `${candidateId}:${subjectId}`;
    if (inFlight.has(flight)) return sendError(reply, request, 409, 'variant_in_progress', 'Вариант уже собирается.', true);
    inFlight.add(flight);
    try {
      return await writeVariant(deps, stores, request, reply, subject, vacancyId, source);
    } catch (error) {
      const failureType = error instanceof Error ? error.name : 'UnknownError';
      request.log.warn({ code: 'hh_resume_variant_failed', failureType }, 'hh-resume-variant-failed');
      return generationFailed(reply, request);
    } finally {
      if (reply.statusCode === 503) failures.add(candidateId);
      inFlight.delete(flight);
    }
  });
}

/** B682 (a01c): «Другой вариант» правки резюме hh.ru; до трёх на правку, на hh.ru ничего не уходит. */
export function registerHhResumeVariantRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const options = { databasePath: deps.config.databasePath, encryptionKey: deps.config.dataEncryptionKey };
  const stores: Stores = { hh: new SqliteHhSessionRepository(options), variants: new SqliteTextVariantRepository(options) };
  app.addHook('onClose', async () => {
    stores.hh.close();
    stores.variants.close();
  });
  register(app, deps, stores);
}
