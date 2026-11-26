import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { MAX_TEXT_VARIANTS } from '../../shared/textVariants';
import type { SqliteTextVariantRepository, TextSubject } from '../candidate/sqliteTextVariantRepository';
import type { FactRewriteProposal, FactRewriteRequest } from '../domain/experienceFactRewrite';
import {
  bulletAt,
  checkFactRewriteVariant,
  factRewriteVariantRequest,
  factRewriteVariantSubject,
  type LocatedBullet,
} from '../domain/factRewriteVariant';
import { writeCheckedVariant } from '../domain/checkedVariant';
import { normalizeWish } from '../domain/textVariants';
import type { RouteDeps } from './deps';
import { authenticateCandidate, csrfError, hasSafeMutationOrigin, sendError, withDeps } from './helpers';
import { generationFailed, limitReached, wishSchema } from './textVariantRoutes';

const KEY_MAX = 160;
const params = z.object({ id: z.string().trim().min(1).max(80) });
const keySchema = z.string().min(1).max(KEY_MAX);
const listQuery = z.object({ key: keySchema }).strict();
const createBody = z.object({ key: keySchema, wish: wishSchema.optional() }).strict();

export interface FactRewriteVariantSource {
  readonly variants: SqliteTextVariantRepository;
  /** Предложение кандидата, если оно ещё действует, и вход, из которого оно собрано. */
  readonly current: (
    deps: RouteDeps,
    candidateId: string,
  ) => { readonly proposal: FactRewriteProposal; readonly request: FactRewriteRequest } | null;
}

interface Located {
  readonly subject: TextSubject;
  readonly bullet: LocatedBullet;
  readonly request: FactRewriteRequest;
}

export function factRewriteSubject(candidateId: string, proposalId: string, key: string): TextSubject {
  return { candidateId, kind: 'resume', subjectId: factRewriteVariantSubject(proposalId, key) };
}

function locate(
  deps: RouteDeps, source: FactRewriteVariantSource, candidateId: string, id: string, key: string,
): Located | null {
  const found = source.current(deps, candidateId);
  if (found?.proposal.id !== id) return null;
  const bullet = bulletAt(found.proposal, key);
  return bullet ? { subject: factRewriteSubject(candidateId, id, key), bullet, request: found.request } : null;
}

function stale(request: FastifyRequest, reply: FastifyReply) {
  return sendError(
    reply, request, 409, 'rewrite_stale',
    'Факты или места работы изменились. Обновите профиль, и консультант предложит заново.', true,
  );
}

function invalid(request: FastifyRequest, reply: FastifyReply) {
  return sendError(reply, request, 400, 'invalid_variant_request', 'Проверьте пожелание.', false);
}

async function writeVariant(
  deps: RouteDeps, source: FactRewriteVariantSource, located: Located,
  body: z.infer<typeof createBody>, request: FastifyRequest, reply: FastifyReply,
) {
  const { variants } = source;
  const { subject } = located;
  const wish = normalizeWish(body.wish);
  const stored = variants.list(subject).variants.map((variant) => variant.text);
  const input = factRewriteVariantRequest(located.request, located.bullet, stored, wish);
  if (!input) return stale(request, reply);
  let rejected = false;
  const text = await writeCheckedVariant({
    request: input,
    write: async (asked) => deps.experienceFactRewriter?.rewriteVariant?.(asked),
    check: (output, onReject) => checkFactRewriteVariant(input, output, onReject),
    onReject: (reason, attempt) => {
      rejected = true;
      request.log.info({ reason, attempt }, 'experience_fact_rewrite_variant_rejected');
    },
  });
  if (!text) {
    request.log.warn({ reason: rejected ? 'rejected' : 'no_answer' }, 'experience_fact_rewrite_variant_failed');
    return generationFailed(reply, request);
  }
  const variant = variants.add({ ...subject, text, wish, createdAt: new Date().toISOString() });
  if (!variant) return limitReached(reply, request);
  return reply.code(201).send({ data: variants.list(subject), meta: { requestId: request.id } });
}

function createHandler(source: FactRewriteVariantSource) {
  // Один вариант пункта за раз: параллельные запросы не обходят предел лишними вызовами модели.
  const inFlight = new Set<string>();
  return async (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
    const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
    if (!candidate) return undefined;
    const { id } = params.parse(request.params);
    const body = createBody.safeParse(request.body ?? {});
    if (!body.success) return invalid(request, reply);
    const located = locate(deps, source, candidate.id, id, body.data.key);
    if (!located) return stale(request, reply);
    if (source.variants.count(located.subject) >= MAX_TEXT_VARIANTS) return limitReached(reply, request);
    const flight = `${candidate.id}:${located.subject.subjectId}`;
    if (inFlight.has(flight)) return sendError(reply, request, 409, 'variant_in_progress', 'Вариант уже собирается.', true);
    inFlight.add(flight);
    try {
      return await writeVariant(deps, source, located, body.data, request, reply);
    } catch (error) {
      const failureType = error instanceof Error ? error.name : 'UnknownError';
      request.log.warn({ failureType }, 'experience_fact_rewrite_variant_failed');
      return generationFailed(reply, request);
    } finally {
      inFlight.delete(flight);
    }
  };
}

function listHandler(source: FactRewriteVariantSource) {
  return async (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
    const candidate = authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
    if (!candidate) return undefined;
    const { id } = params.parse(request.params);
    const query = listQuery.safeParse(request.query ?? {});
    if (!query.success) return invalid(request, reply);
    const subject = factRewriteSubject(candidate.id, id, query.data.key);
    return { data: source.variants.list(subject), meta: { requestId: request.id } };
  };
}

/** B786 (k06): «Другой вариант» пункта; в резюме ничего не пишется до «Применить». */
export function registerFactRewriteVariantRoutes(
  app: FastifyInstance, deps: RouteDeps, source: FactRewriteVariantSource,
): void {
  const url = '/api/v1/candidate/experience-fact-rewrite/:id/variants';
  app.get(url, withDeps(deps, listHandler(source)));
  app.post(url, withDeps(deps, createHandler(source)));
}
