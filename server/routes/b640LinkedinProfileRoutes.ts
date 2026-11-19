import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  LINKEDIN_OFFER_KEY,
  LINKEDIN_VARIANTS_MAX,
  type LinkedinOffer,
  type LinkedinProfileView,
} from '../../shared/b640LinkedinProfile';
import type { QuotaKey } from '../billing/tariffQuotas';
import { LinkedinSectionRepository } from '../linkedinProfile/linkedinSectionRepository';
import { LINKEDIN_REWRITE_BUDGET_MS, rewrittenSuggestions } from '../linkedinProfile/linkedinRewrite';
import { checkLinkedinVariant, linkedinVariantRequest } from '../linkedinProfile/linkedinVariant';
import { profileCurrent } from '../linkedinProfile/profileCurrent';
import { offerOf, profileSections, shownTexts, type OfferMarks } from '../linkedinProfile/profileView';
import { buildSectionSuggestions, type SectionSuggestions, type SuggestionInput } from '../linkedinProfile/sectionSuggestions';
import { requireCabinetB640 } from './cabinetB640Flag';
import type { RouteDeps } from './deps';
import { sendError } from './helpers';
import { releaseTariffQuota, requireTariffQuota } from './tariffQuotaGuard';

const BASE = '/api/v1/candidate/b640/linkedin/profile';
const READ_LIMIT = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
const WRITE_LIMIT = { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } };
/** B645 п. 6 (решение владельца 19.11): «Предложить заново» идёт в квоту генераций тарифа. */
export const LINKEDIN_VARIANT_QUOTA: QuotaKey = 'applications';

const offerKey = z.string().regex(LINKEDIN_OFFER_KEY);
const keySchema = z.object({ key: offerKey });
const doneSchema = z.object({ keys: z.array(offerKey).min(1).max(60) }).strict();
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
  readonly view: LinkedinProfileView;
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
  return { input, suggestions, view: { kind: 'ready', sections: profileSections(current, suggestions, marks) } };
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
    return ok(request, { done: Object.fromEntries(repo.markDone(candidateId, body.data.keys)) });
  });
}

async function newVariant(
  deps: RouteDeps,
  repo: LinkedinSectionRepository,
  candidateId: string,
  key: string,
): Promise<{ readonly offer: LinkedinOffer } | { readonly error: 'missing' | 'unavailable' }> {
  const profile = await loadProfile(deps, repo, candidateId);
  if (profile.view.kind !== 'ready') return { error: 'missing' };
  const marks: OfferMarks = { done: repo.getDone(candidateId), variants: repo.getVariants(candidateId) };
  const variantRequest = linkedinVariantRequest(key, profile.input, shownTexts(key, profile.suggestions, marks));
  if (!variantRequest) return { error: 'missing' };
  const output = await deps.experienceFactRewriter?.linkedinVariant?.(variantRequest).catch(() => null);
  const text = output ? checkLinkedinVariant(variantRequest, output) : null;
  if (!text) return { error: 'unavailable' };
  repo.addVariant(candidateId, key, text);
  return { offer: offerOf(key, null, { done: new Map(), variants: repo.getVariants(candidateId) })! };
}

function registerVariant(app: FastifyInstance, deps: RouteDeps, repo: LinkedinSectionRepository): void {
  app.post(`${BASE}/offers/:key/variant`, WRITE_LIMIT, async (request, reply) => {
    const candidateId = candidateOf(deps, request, reply);
    if (!candidateId) return reply;
    const params = keySchema.safeParse(request.params);
    if (!params.success) return sendError(reply, request, 400, 'invalid_offer', 'Нет такого предложения.', false);
    const { key } = params.data;
    const used = repo.getVariants(candidateId).get(key)?.length ?? 0;
    if (used >= LINKEDIN_VARIANTS_MAX) {
      return sendError(reply, request, 409, 'variant_limit_reached', 'Других вариантов больше не будет.', false);
    }
    const unitKey = `linkedin-variant:${key}:${used + 1}`;
    if (!requireTariffQuota(deps, request, reply, candidateId, LINKEDIN_VARIANT_QUOTA, unitKey)) return reply;
    const result = await newVariant(deps, repo, candidateId, key);
    if ('offer' in result) return ok(request, result.offer);
    releaseTariffQuota(deps, candidateId, LINKEDIN_VARIANT_QUOTA, unitKey);
    if (result.error === 'missing') return sendError(reply, request, 404, 'offer_not_found', 'Нет такого предложения.', false);
    return sendError(reply, request, 503, 'variant_unavailable', 'Не получилось предложить другой вариант. Попробуйте ещё раз.', true);
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
