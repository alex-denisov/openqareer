import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CandidateSnapshot } from '../data/candidateStore';
import { CandidateStoreConflictError } from '../data/store/errors';
import {
  arithmeticFails,
  buildFactRewriteRequest,
  checkFactRewrite,
  InvalidBulletEditError,
  withBulletEdits,
  type FactRewriteModelOutput,
  type FactRewriteProposal,
  type FactRewriteRequest,
} from '../domain/experienceFactRewrite';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import type { ExperienceFactRewriter } from '../providers/experienceFactRewriter';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

function requestDigest(request: FactRewriteRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

function rewriteRequestOf(snapshot: CandidateSnapshot): FactRewriteRequest {
  return buildFactRewriteRequest(snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT, snapshot.memory);
}

function digestOf(snapshot: CandidateSnapshot): string {
  return requestDigest(rewriteRequestOf(snapshot));
}

/**
 * Two tabs opening «Опыт» at once share one model call. The proposal itself
 * lives on the draft (owner, 29.10): a deploy must not change the words the
 * candidate has already read.
 */
class RunningRewrites {
  private readonly running = new Map<string, Promise<FactRewriteProposal | null>>();

  produce(key: string, make: () => Promise<FactRewriteProposal | null>) {
    const pending = this.running.get(key);
    if (pending) return pending;
    const job = make().finally(() => this.running.delete(key));
    this.running.set(key, job);
    return job;
  }
}

function failingArithmetic(output: FactRewriteModelOutput): string[] {
  return output.places.flatMap((place) =>
    place.bullets.map((bullet) => bullet.text).filter(arithmeticFails),
  );
}

/** A bullet whose numbers contradict each other goes back to the model once. */
async function makeProposal(
  rewriter: ExperienceFactRewriter,
  request: FactRewriteRequest,
): Promise<FactRewriteProposal | null> {
  const first = await rewriter.rewrite(request);
  if (!first) return null;
  const corrections = failingArithmetic(first);
  const second = corrections.length ? await rewriter.rewrite({ ...request, corrections }) : null;
  return checkFactRewrite(request, second ?? first, randomUUID());
}

function signedInCandidate(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) {
    csrfError(request, reply);
    return null;
  }
  return authenticateCandidate(request, reply, deps.candidateStore, deps.authService, deps.config);
}

function reply200<T>(request: FastifyRequest, data: T) {
  return { data, meta: { requestId: request.id } };
}

function proposeHandler(running: RunningRewrites): Handler {
  return async (deps, request, reply) => {
    const candidate = signedInCandidate(deps, request, reply);
    if (!candidate) return undefined;
    const snapshot = deps.candidateStore.getSnapshot(candidate.id);
    const rewriteRequest = rewriteRequestOf(snapshot);
    if (rewriteRequest.facts.length === 0 || rewriteRequest.places.length === 0) {
      return reply200(request, { proposal: null });
    }
    const digest = requestDigest(rewriteRequest);
    const stored = snapshot.resume?.draft.factRewriteProposal;
    if (stored?.digest === digest) return reply200(request, { proposal: stored.proposal });
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
    const proposal = await running.produce(`${candidate.id}:${digest}`, () =>
      makeProposal(rewriter, rewriteRequest),
    );
    if (!proposal) {
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
    deps.candidateStore.saveFactRewriteProposal(
      candidate.id,
      { digest, proposal },
      (latest) => digestOf(latest) === digest,
    );
    return reply200(request, { proposal });
  };
}

const idParams = z.object({ id: z.string().trim().min(1).max(80) });
const applyBody = z
  .object({ edits: z.record(z.string().max(160), z.string().max(400).nullable()).optional() })
  .strict()
  .optional();

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

function editError(request: FastifyRequest, reply: FastifyReply) {
  return sendError(
    reply,
    request,
    400,
    'rewrite_edit_invalid',
    'Пункт пустой или слишком длинный, либо все пункты убраны. Поправьте и примите снова.',
    false,
  );
}

/** The stored proposal with the candidate's edits; `null` when the edits leave nothing valid. */
function editedProposal(
  proposal: FactRewriteProposal,
  edits: Readonly<Record<string, string | null>>,
): FactRewriteProposal | null {
  try {
    const edited = withBulletEdits(proposal, edits);
    return edited.places.length ? edited : null;
  } catch (error) {
    if (error instanceof InvalidBulletEditError) return null;
    throw error;
  }
}

const handleApply: Handler = async (deps, request, reply) => {
  const candidate = signedInCandidate(deps, request, reply);
  if (!candidate) return undefined;
  const { id } = idParams.parse(request.params);
  const body = applyBody.safeParse(request.body ?? undefined);
  if (!body.success) return editError(request, reply);
  const pending = deps.candidateStore.getSnapshot(candidate.id).resume?.draft.factRewriteProposal;
  if (pending?.proposal.id !== id) return staleError(request, reply);
  const proposal = editedProposal(pending.proposal, body.data?.edits ?? {});
  if (!proposal) return editError(request, reply);
  try {
    const rewrite = deps.candidateStore.applyExperienceFactRewrite(
      candidate.id,
      proposal,
      (snapshot) => digestOf(snapshot) === pending.digest,
    );
    return reply200(request, { rewrite });
  } catch (error) {
    if (!(error instanceof CandidateStoreConflictError)) throw error;
    return staleError(request, reply);
  }
};

const handleRevert: Handler = async (deps, request, reply) => {
  const candidate = signedInCandidate(deps, request, reply);
  if (!candidate) return undefined;
  const { id } = idParams.parse(request.params);
  if (!deps.candidateStore.revertExperienceFactRewrite(candidate.id, id)) {
    return sendError(reply, request, 404, 'rewrite_not_found', 'Эта правка уже отменена.', false);
  }
  return reply200(request, { reverted: true });
};

export async function registerExperienceFactRewriteRoutes(
  app: FastifyInstance,
  deps: RouteDeps,
): Promise<void> {
  const running = new RunningRewrites();
  app.post('/api/v1/candidate/experience-fact-rewrite', withDeps(deps, proposeHandler(running)));
  app.post('/api/v1/candidate/experience-fact-rewrite/:id/apply', withDeps(deps, handleApply));
  app.post('/api/v1/candidate/experience-fact-rewrite/:id/revert', withDeps(deps, handleRevert));
}
