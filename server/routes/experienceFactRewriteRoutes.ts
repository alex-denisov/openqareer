import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CandidateSnapshot } from '../data/candidateStore';
import { CandidateStoreConflictError } from '../data/store/errors';
import {
  buildFactRewriteRequest,
  checkFactRewrite,
  type FactRewriteProposal,
  type FactRewriteRequest,
} from '../domain/experienceFactRewrite';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

interface CachedProposal {
  readonly digest: string;
  readonly proposal: FactRewriteProposal;
}

/**
 * One proposal per candidate, kept while its facts and places stay the same:
 * opening «Опыт» again must not call the model again. A restart only costs
 * one more call; the proposal is not the candidate's data until accepted.
 */
const MAX_CACHED_CANDIDATES = 500;

function requestDigest(request: FactRewriteRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

function rewriteRequestOf(snapshot: CandidateSnapshot): FactRewriteRequest {
  return buildFactRewriteRequest(snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT, snapshot.memory);
}

class ProposalCache {
  private readonly proposals = new Map<string, CachedProposal>();
  private readonly running = new Map<string, Promise<CachedProposal | null>>();

  get(candidateId: string, digest: string): CachedProposal | undefined {
    const cached = this.proposals.get(candidateId);
    return cached?.digest === digest ? cached : undefined;
  }

  byId(candidateId: string, proposalId: string): CachedProposal | undefined {
    const cached = this.proposals.get(candidateId);
    return cached?.proposal.id === proposalId ? cached : undefined;
  }

  forget(candidateId: string): void {
    this.proposals.delete(candidateId);
  }

  /** Two tabs opening «Опыт» at once share one model call. */
  async produce(
    candidateId: string,
    digest: string,
    make: () => Promise<FactRewriteProposal | null>,
  ): Promise<CachedProposal | null> {
    const key = `${candidateId}:${digest}`;
    const pending = this.running.get(key);
    if (pending) return pending;
    const job = make()
      .then((proposal) => (proposal ? this.store(candidateId, { digest, proposal }) : null))
      .finally(() => this.running.delete(key));
    this.running.set(key, job);
    return job;
  }

  private store(candidateId: string, cached: CachedProposal): CachedProposal {
    this.proposals.delete(candidateId);
    this.proposals.set(candidateId, cached);
    const oldest = this.proposals.keys().next().value;
    if (this.proposals.size > MAX_CACHED_CANDIDATES && oldest) this.proposals.delete(oldest);
    return cached;
  }
}

function signedInCandidate(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) {
    csrfError(request, reply);
    return null;
  }
  return authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
}

function proposeHandler(cache: ProposalCache): Handler {
  return async (deps, request, reply) => {
    const candidate = signedInCandidate(deps, request, reply);
    if (!candidate) return undefined;
    const rewriteRequest = rewriteRequestOf(deps.candidateStore.getSnapshot(candidate.id));
    if (rewriteRequest.facts.length === 0 || rewriteRequest.places.length === 0) {
      return { data: { proposal: null }, meta: { requestId: request.id } };
    }
    const digest = requestDigest(rewriteRequest);
    const rewriter = deps.experienceFactRewriter;
    if (!rewriter) {
      return sendError(
        reply,
        request,
        503,
        'rewrite_unavailable',
        'Консультант сейчас недоступен.',
        true,
      );
    }
    const cached =
      cache.get(candidate.id, digest) ??
      (await cache.produce(candidate.id, digest, async () => {
        const output = await rewriter.rewrite(rewriteRequest);
        return output ? checkFactRewrite(rewriteRequest, output, randomUUID()) : null;
      }));
    if (!cached) {
      request.log.warn({ facts: rewriteRequest.facts.length }, 'experience_fact_rewrite_failed');
      return sendError(
        reply,
        request,
        502,
        'rewrite_failed',
        'Консультант не успел подготовить формулировки. Попробуйте ещё раз.',
        true,
      );
    }
    return { data: { proposal: cached.proposal }, meta: { requestId: request.id } };
  };
}

const idParams = z.object({ id: z.string().trim().min(1).max(80) });

function staleError(request: FastifyRequest, reply: FastifyReply) {
  return sendError(
    reply,
    request,
    409,
    'rewrite_stale',
    'Факты или места работы изменились. Обновите профиль, и консультант предложит заново.',
    true,
  );
}

function applyHandler(cache: ProposalCache): Handler {
  return async (deps, request, reply) => {
    const candidate = signedInCandidate(deps, request, reply);
    if (!candidate) return undefined;
    const { id } = idParams.parse(request.params);
    const cached = cache.byId(candidate.id, id);
    if (!cached) return staleError(request, reply);
    try {
      const rewrite = deps.candidateStore.applyExperienceFactRewrite(
        candidate.id,
        cached.proposal,
        (snapshot) => requestDigest(rewriteRequestOf(snapshot)) === cached.digest,
      );
      cache.forget(candidate.id);
      return { data: { rewrite }, meta: { requestId: request.id } };
    } catch (error) {
      if (!(error instanceof CandidateStoreConflictError)) throw error;
      return staleError(request, reply);
    }
  };
}

const handleRevert: Handler = async (deps, request, reply) => {
  const candidate = signedInCandidate(deps, request, reply);
  if (!candidate) return undefined;
  const { id } = idParams.parse(request.params);
  if (!deps.candidateStore.revertExperienceFactRewrite(candidate.id, id)) {
    return sendError(reply, request, 404, 'rewrite_not_found', 'Эта правка уже отменена.', false);
  }
  return { data: { reverted: true }, meta: { requestId: request.id } };
};

export async function registerExperienceFactRewriteRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const cache = new ProposalCache();
  app.post('/api/v1/candidate/experience-fact-rewrite', withDeps(deps, proposeHandler(cache)));
  app.post(
    '/api/v1/candidate/experience-fact-rewrite/:id/apply',
    withDeps(deps, applyHandler(cache)),
  );
  app.post('/api/v1/candidate/experience-fact-rewrite/:id/revert', withDeps(deps, handleRevert));
}
