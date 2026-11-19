import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  LINKEDIN_OFFER_KEY,
  LINKEDIN_VARIANTS_MAX,
  type LinkedinOffer,
  type LinkedinProfileView,
} from '../../shared/b640LinkedinProfile';
import { LinkedinSectionRepository } from '../linkedinProfile/linkedinSectionRepository';
import { LINKEDIN_REWRITE_BUDGET_MS, rewrittenSuggestions } from '../linkedinProfile/linkedinRewrite';
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
/** Сохранённых вариантов «Предложить заново» — всего три с первым (без квоты тарифа, решение 12.11/19.11). */
const STORED_VARIANTS_MAX = LINKEDIN_VARIANTS_MAX - 1;

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

async function loadProfile(deps: RouteDeps, repo: LinkedinSectionRepository, candidateId: string): Promise<Profile> {
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const draft = snapshot.resume?.draft;
  const input = { memory: snapshot.memory, draft };
  const imported = snapshot.importedSources.some((source) => source.platform === 'linkedin');
  if (!imported || !draft) return { input, suggestions: buildSectionSuggestions(input), view: { kind: 'no_import' } };
  const current = profileCurrent(draft, new Map(snapshot.memory.map((memory) => [memory.id, memory.statement])));
  // B645: «О себе» и «Опыт» — пересказ моделью; без её принятого ответа первого предложения по ним нет.
  const suggestions = await rewrittenSuggestions(
    buildSectionSuggestions(input), input, current.lines.about ?? undefined, deps.experienceFactRewriter, LINKEDIN_REWRITE_BUDGET_MS,
  );
  const marks: OfferMarks = { done: repo.getDone(candidateId), variants: repo.getVariants(candidateId) };
  const view: LinkedinProfileView = { kind: 'ready', sections: profileSections(current, suggestions, marks) };
  return { input, suggestions, currentAbout: current.lines.about ?? undefined, view };
}

function registerView(app: FastifyInstance, deps: RouteDeps, repo: LinkedinSectionRepository): void {
  app.get(BASE, READ_LIMIT, async (request, reply) => {
    const candidateId = candidateOf(deps, request, reply);
    return candidateId ? ok(request, (await loadProfile(deps, repo, candidateId)).view) : reply;
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
): Promise<{ readonly offer: LinkedinOffer } | { readonly error: 'missing' | 'unavailable' | 'limit' }> {
  const profile = await loadProfile(deps, repo, candidateId);
  if (profile.view.kind !== 'ready') return { error: 'missing' };
  const marks: OfferMarks = { done: repo.getDone(candidateId), variants: repo.getVariants(candidateId) };
  const avoid = shownTexts(key, profile.suggestions, marks);
  const variantRequest = linkedinVariantRequest(key, profile.input, avoid, profile.currentAbout);
  if (!variantRequest) return { error: 'missing' };
  const writer = deps.experienceFactRewriter;
  const output = writer?.linkedinVariant ? await writer.linkedinVariant(variantRequest).catch(() => null) : null;
  const text = output ? checkLinkedinVariant(variantRequest, output) : null;
  if (!text) return { error: 'unavailable' };
  if (!repo.addVariant(candidateId, key, text, STORED_VARIANTS_MAX)) return { error: 'limit' };
  const base = avoid.length > (marks.variants.get(key)?.length ?? 0) ? avoid[0] : null;
  return { offer: offerOf(key, base, { done: new Map(), variants: repo.getVariants(candidateId) })! };
}

/** Один вариант за раз на ключ кандидата: иначе два запроса обходят потолок вариантов. */
const inFlight = new Set<string>();

function registerVariant(app: FastifyInstance, deps: RouteDeps, repo: LinkedinSectionRepository): void {
  app.post(`${BASE}/offers/:key/variant`, WRITE_LIMIT, async (request, reply) => {
    const candidateId = candidateOf(deps, request, reply);
    if (!candidateId) return reply;
    const params = keySchema.safeParse(request.params);
    if (!params.success) return sendError(reply, request, 400, 'invalid_offer', 'Нет такого предложения.', false);
    const { key } = params.data;
    const lock = `${candidateId}:${key}`;
    if (inFlight.has(lock)) {
      return sendError(reply, request, 409, 'variant_in_progress', 'Другой вариант уже готовится.', true);
    }
    const used = repo.getVariants(candidateId).get(key)?.length ?? 0;
    if (used >= STORED_VARIANTS_MAX) return sendError(reply, request, 409, 'variant_limit_reached', LIMIT_TEXT, false);
    inFlight.add(lock);
    try {
      const result = await newVariant(deps, repo, candidateId, key);
      if ('offer' in result) return ok(request, result.offer);
      if (result.error === 'missing') return sendError(reply, request, 404, 'offer_not_found', 'Нет такого предложения.', false);
      if (result.error === 'limit') return sendError(reply, request, 409, 'variant_limit_reached', LIMIT_TEXT, false);
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
