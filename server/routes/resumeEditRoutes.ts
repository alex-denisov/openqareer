import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  resumeEditDecisionSchema,
  type ResumeEditChoices,
  type ResumeEditDecision,
  type ResumeEditsState,
} from '../../shared/resumeVacancyEdits';
import type { SqliteResumeEditChoicesRepository } from '../candidate/sqliteResumeEditChoicesRepository';
import {
  editSource,
  keepsSourceNumbers,
  resumeVacancyEdits,
  tailorResumeSlice,
  withDecision,
} from '../domain/resumeVacancyEdits';
import { documentLang, isTranslated, translateDocument } from '../domain/resumeTranslation';
import type { VacancyCluster } from '../domain/unifiedVacancy';
import { resolveRowVacancyCluster } from '../vacancies/poolVacancyCluster';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';
import { letterResumeKind, targetedSliceFor } from './letterApprovalResume';
import { currentMaster } from './resumeMaster';

export type ResumeEditDeps = RouteDeps & {
  readonly resumeEdits: SqliteResumeEditChoicesRepository;
};

type Refusal = readonly [status: number, code: string, message: string];
const isRefusal = (value: ResumeEditChoices | Refusal): value is Refusal => Array.isArray(value);
const INVALID: Refusal = [400, 'invalid_resume_edit', 'Правка не прошла проверку.'];
const STALE: Refusal = [409, 'resume_edit_stale', 'Резюме изменилось. Откройте его снова.'];
const NUMBERS: Refusal = [422, 'resume_edit_numbers', 'Этого числа нет в профиле.'];
const UNTRANSLATED: Refusal = [503, 'resume_not_translated', 'Перевод не собрался. Повторите.'];
/** Первый перевод всего резюме: десятки строк параллельно. */
const TRANSLATION_BUDGET_MS = 40_000;
const nowIso = () => new Date().toISOString();

const PATH = '/api/v1/candidate/vacancies/:id/resume-edits';

function context(deps: ResumeEditDeps, request: FastifyRequest, reply: FastifyReply) {
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const cluster = resolveRowVacancyCluster(
    deps.multiSourceEngine,
    (request.params as { id: string }).id,
  );
  if (!cluster) {
    sendError(reply, request, 404, 'vacancy_not_found', 'Вакансия не найдена.', false);
    return undefined;
  }
  return { candidateId: candidate.id, cluster };
}

/** Общее резюме (Free) под вакансию не меняется: правок у него нет. */
function sliceOf(deps: RouteDeps, candidateId: string, cluster: VacancyCluster) {
  if (letterResumeKind(deps, candidateId) === 'master') return null;
  return targetedSliceFor(currentMaster(deps, candidateId), cluster);
}

type Slice = NonNullable<ReturnType<typeof sliceOf>>;

function stateOf(slice: Slice | null, choices: ResumeEditChoices): ResumeEditsState {
  if (!slice) return { edits: [], lang: null };
  const { document } = tailorResumeSlice(slice, choices);
  const shown =
    choices.lang && isTranslated(document, choices.lang, choices.translations ?? {})
      ? choices.lang
      : documentLang(document);
  return { edits: resumeVacancyEdits(slice, choices), lang: shown };
}

async function handleRead(deps: ResumeEditDeps, request: FastifyRequest, reply: FastifyReply) {
  const found = context(deps, request, reply);
  if (!found) return undefined;
  const slice = sliceOf(deps, found.candidateId, found.cluster);
  const choices = deps.resumeEdits.read(found.candidateId, found.cluster.id);
  reply.header('cache-control', 'private, no-store');
  return { data: stateOf(slice, choices), meta: { requestId: request.id } };
}

/** Что кандидат решил; отказ — код и слова ответа. */
function decided(
  slice: Slice,
  current: ResumeEditChoices,
  decision: ResumeEditDecision,
): ResumeEditChoices | Refusal {
  if (decision.action === 'lang') {
    const lang = decision.lang === documentLang(slice.document) ? undefined : decision.lang;
    return { ...current, lang };
  }
  const source = editSource(slice, decision.id);
  if (source === null) return STALE;
  if (decision.action === 'text' && !keepsSourceNumbers(decision.text, source)) return NUMBERS;
  return withDecision(current, decision, source);
}

/** Переводит недостающие строки; готовое хранится и при сбое, чтобы повтор просил только остаток. */
async function translated(
  deps: ResumeEditDeps,
  found: { readonly candidateId: string; readonly cluster: VacancyCluster },
  slice: Slice,
  choices: ResumeEditChoices,
): Promise<ResumeEditChoices | Refusal> {
  if (!choices.lang) return choices;
  const result = await translateDocument(
    tailorResumeSlice(slice, choices).document,
    choices.lang,
    choices.translations ?? {},
    deps.experienceFactRewriter,
    TRANSLATION_BUDGET_MS,
  );
  if (result.complete) return { ...choices, translations: result.translations };
  const { candidateId, cluster } = found;
  const current = deps.resumeEdits.read(candidateId, cluster.id);
  const translations = { ...current.translations, ...result.translations };
  deps.resumeEdits.save(candidateId, cluster.id, { ...current, translations }, nowIso());
  return UNTRANSLATED;
}

async function handleDecide(deps: ResumeEditDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const found = context(deps, request, reply);
  if (!found) return undefined;
  const refuse = ([status, code, message]: Refusal) =>
    sendError(reply, request, status, code, message, status === 503);
  const parsed = resumeEditDecisionSchema.safeParse(request.body);
  if (!parsed.success) return refuse(INVALID);
  const { candidateId, cluster } = found;
  const slice = sliceOf(deps, candidateId, cluster);
  if (!slice) return refuse(STALE);
  const read = () => deps.resumeEdits.read(candidateId, cluster.id);
  const wanted = decided(slice, read(), parsed.data);
  if (isRefusal(wanted)) return refuse(wanted);
  const ready = await translated(deps, found, slice, wanted);
  if (isRefusal(ready)) return refuse(ready);
  // Пока шёл перевод, кандидат мог решить другую правку: решение ложится на свежие.
  const latest = decided(slice, read(), parsed.data);
  if (isRefusal(latest)) return refuse(latest);
  const translations = { ...latest.translations, ...ready.translations };
  const choices = Object.keys(translations).length > 0 ? { ...latest, translations } : latest;
  deps.resumeEdits.save(candidateId, cluster.id, choices, nowIso());
  return { data: stateOf(slice, choices), meta: { requestId: request.id } };
}

/** B785, o03: правки резюме под вакансию — список и решения кандидата. */
export function registerResumeEditRoutes(app: FastifyInstance, deps: ResumeEditDeps): void {
  app.get(PATH, withDeps(deps, handleRead));
  app.put(PATH, { bodyLimit: 8 * 1_024 }, withDeps(deps, handleDecide));
}
