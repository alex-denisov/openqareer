import type { FastifyBaseLogger, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  LINKEDIN_OFFER_KEY,
  type LinkedinOffer,
  type LinkedinProfileView,
} from '../../shared/b640LinkedinProfile';
import { MAX_TEXT_VARIANTS } from '../../shared/textVariants';
import { LinkedinSectionRepository } from '../linkedinProfile/linkedinSectionRepository';
import { LINKEDIN_REWRITE_BUDGET_MS, LINKEDIN_VIEW_WAIT_MS, rewrittenSuggestions } from '../linkedinProfile/linkedinRewrite';
import { checkLinkedinVariant, linkedinVariantRequest } from '../linkedinProfile/linkedinVariant';
import { profileCurrent } from '../linkedinProfile/profileCurrent';
import { offerOf, profileSections, shownTexts, type OfferMarks } from '../linkedinProfile/profileView';
import { buildSectionSuggestions, type SectionSuggestions, type SuggestionInput } from '../linkedinProfile/sectionSuggestions';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError } from './helpers';

const BASE = '/api/v1/candidate/b640/linkedin/profile';
const READ_LIMIT = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
const WRITE_LIMIT = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
/** B692: каждый запрос варианта — вызов модели; строже общего лимита записи. */
const VARIANT_LIMIT = { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } };
/** B692: неудачных вызовов модели на кандидата за час — успешные и так ограничены тремя вариантами. */
const VARIANT_FAILURES_MAX = 5;
const HOUR_MS = 60 * 60 * 1000;
/** Сохранённых вариантов «Предложить заново» — три, первый не в счёт; без квоты тарифа. */
const STORED_VARIANTS_MAX = MAX_TEXT_VARIANTS;

const offerKey = z.string().regex(LINKEDIN_OFFER_KEY);
const keySchema = z.object({ key: offerKey });
const doneSchema = z.object({ keys: z.array(offerKey).min(1).max(60) }).strict();
const LIMIT_TEXT = 'Других вариантов больше не будет.';
const ok = (request: FastifyRequest, data: unknown) => ({ data, meta: { requestId: request.id } });

function candidateOf(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): string | null {
  const principal = requireCabinetB640(request, reply, deps);
  if (!principal) return null;
  if (principal.candidate) return principal.candidate.id;
  sendError(reply, request, 401, 'unauthorized', 'Нужна действующая сессия кандидата.', false);
  return null;
}

interface Profile {
  readonly input: SuggestionInput;
  readonly suggestions: SectionSuggestions;
  readonly currentAbout?: string;
  readonly view: LinkedinProfileView;
}

/** Ключи, которые у кандидата вообще бывают: разделы с предложениями и места работы из импорта. */
function knownKeys(deps: RouteDeps, candidateId: string): Set<string> {
  const draft = deps.candidateStore.getSnapshot(candidateId).resume?.draft;
  return new Set(['headline', 'about', 'skills', ...(draft?.experience ?? []).map((place) => `experience:${place.id}`)]);
}

/** `waitMs`: экран ждёт модель коротко, «Предложить заново» — до полного бюджета (ему нужен первый вариант). */
async function loadProfile(
  deps: RouteDeps,
  repo: LinkedinSectionRepository,
  candidateId: string,
  waitMs: number = LINKEDIN_REWRITE_BUDGET_MS,
  log?: FastifyBaseLogger,
): Promise<Profile> {
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const draft = snapshot.resume?.draft;
  const input = { memory: snapshot.memory, draft };
  const imported = snapshot.importedSources.some((source) => source.platform === 'linkedin');
  if (!imported || !draft) return { input, suggestions: buildSectionSuggestions(input), view: { kind: 'no_import' } };
  const current = profileCurrent(draft, new Map(snapshot.memory.map((memory) => [memory.id, memory.statement])));
  // B645: «О себе» и «Опыт» — пересказ моделью; без её принятого ответа первого предложения по ним нет.
  const suggestions = await rewrittenSuggestions(
    buildSectionSuggestions(input), input, current.lines.about ?? undefined, deps.experienceFactRewriter, waitMs,
    // B692: почему текст модели не принят — только раздел и код причины, без текста кандидата.
    (section, reason) => log?.info({ section, reason }, 'linkedin_rewrite_rejected'),
  );
  const marks: OfferMarks = { done: repo.getDone(candidateId), variants: repo.getVariants(candidateId) };
  const view: LinkedinProfileView = {
    kind: 'ready', sections: profileSections(current, suggestions, marks), rewriting: suggestions.rewriting,
  };
  return { input, suggestions, currentAbout: current.lines.about ?? undefined, view };
}

function registerView(app: FastifyInstance, deps: RouteDeps, repo: LinkedinSectionRepository): void {
  app.get(BASE, READ_LIMIT, async (request, reply) => {
    const candidateId = candidateOf(deps, request, reply);
    return candidateId ? ok(request, (await loadProfile(deps, repo, candidateId, LINKEDIN_VIEW_WAIT_MS, request.log)).view) : reply;
  });
  app.post(`${BASE}/done`, WRITE_LIMIT, async (request, reply) => {
    const candidateId = candidateOf(deps, request, reply);
    if (!candidateId) return reply;
    const body = doneSchema.safeParse(request.body);
    if (!body.success) return sendError(reply, request, 400, 'invalid_offer', 'Не те предложения для отметки.', false);
    // Чужие ключи не пишутся: отмечается только то, что у кандидата есть.
    const known = knownKeys(deps, candidateId);
    const keys = body.data.keys.filter((key) => known.has(key));
    return ok(request, { done: Object.fromEntries(repo.markDone(candidateId, keys)) });
  });
}

async function newVariant(
  deps: RouteDeps,
  repo: LinkedinSectionRepository,
  candidateId: string,
  key: string,
  log: FastifyBaseLogger,
): Promise<{ readonly offer: LinkedinOffer } | { readonly error: 'missing' | 'unavailable' | 'limit' }> {
  const profile = await loadProfile(deps, repo, candidateId);
  if (profile.view.kind !== 'ready') return { error: 'missing' };
  const marks: OfferMarks = { done: repo.getDone(candidateId), variants: repo.getVariants(candidateId) };
  const avoid = shownTexts(key, profile.suggestions, marks);
  const variantRequest = linkedinVariantRequest(key, profile.input, avoid, profile.currentAbout);
  if (!variantRequest) return { error: 'missing' };
  const writer = deps.experienceFactRewriter;
  const output = writer?.linkedinVariant ? await writer.linkedinVariant(variantRequest).catch(() => null) : null;
  const text = output
    ? checkLinkedinVariant(
        variantRequest, output,
        (reason) => log.info({ section: variantRequest.target, reason }, 'linkedin_variant_rejected'),
      )
    : null;
  if (!text) return { error: 'unavailable' };
  if (!repo.addVariant(candidateId, key, text, STORED_VARIANTS_MAX)) return { error: 'limit' };
  const base = avoid.length > (marks.variants.get(key)?.length ?? 0) ? avoid[0] : null;
  return { offer: offerOf(key, base, { done: new Map(), variants: repo.getVariants(candidateId) })! };
}

/** Один вариант за раз на ключ кандидата: иначе два запроса обходят потолок вариантов. */
const inFlight = new Set<string>();

/** Неудачные вызовы модели по кандидатам за последний час (в памяти процесса). */
function failureLog() {
  const failures = new Map<string, readonly number[]>();
  const recent = (candidateId: string, now: number) =>
    (failures.get(candidateId) ?? []).filter((at) => now - at < HOUR_MS);
  return {
    exhausted: (candidateId: string) => recent(candidateId, Date.now()).length >= VARIANT_FAILURES_MAX,
    add: (candidateId: string) => {
      const now = Date.now();
      failures.set(candidateId, [...recent(candidateId, now), now]);
    },
  };
}

function registerVariant(app: FastifyInstance, deps: RouteDeps, repo: LinkedinSectionRepository): void {
  const failures = failureLog();
  app.post(`${BASE}/offers/:key/variant`, VARIANT_LIMIT, async (request, reply) => {
    const candidateId = candidateOf(deps, request, reply);
    if (!candidateId) return reply;
    const params = keySchema.safeParse(request.params);
    if (!params.success) return sendError(reply, request, 400, 'invalid_offer', 'Нет такого предложения.', false);
    const { key } = params.data;
    if (!knownKeys(deps, candidateId).has(key)) return sendError(reply, request, 404, 'offer_not_found', 'Нет такого предложения.', false);
    if (failures.exhausted(candidateId)) {
      return sendError(reply, request, 429, 'variant_attempts_exhausted', 'Не получилось предложить другой вариант. Попробуйте позже.', true);
    }
    const lock = `${candidateId}:${key}`;
    if (inFlight.has(lock)) {
      return sendError(reply, request, 409, 'variant_in_progress', 'Другой вариант уже готовится.', true);
    }
    const used = repo.getVariants(candidateId).get(key)?.length ?? 0;
    if (used >= STORED_VARIANTS_MAX) return sendError(reply, request, 409, 'variant_limit_reached', LIMIT_TEXT, false);
    inFlight.add(lock);
    try {
      const result = await newVariant(deps, repo, candidateId, key, request.log);
      if ('offer' in result) return ok(request, result.offer);
      if (result.error === 'missing') return sendError(reply, request, 404, 'offer_not_found', 'Нет такого предложения.', false);
      if (result.error === 'limit') return sendError(reply, request, 409, 'variant_limit_reached', LIMIT_TEXT, false);
      failures.add(candidateId);
      return sendError(reply, request, 503, 'variant_unavailable', 'Не получилось предложить другой вариант. Попробуйте ещё раз.', true);
    } finally {
      inFlight.delete(lock);
    }
  });
}

/**
 * B692/B645 (a03): разделы профиля LinkedIn за флагом `cabinetB640`. «Сейчас» — из импорта LinkedIn;
 * на LinkedIn ничего не уходит: кандидат копирует предложение сам и отмечает «Выполнено».
 */
export function registerB640LinkedinProfileRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const database = deps.candidateActionRepository?.getDatabase();
  if (!database) return;
  const repo = new LinkedinSectionRepository(database);
  registerView(app, deps, repo);
  registerVariant(app, deps, repo);
}
