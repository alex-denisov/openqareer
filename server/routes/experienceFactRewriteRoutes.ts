import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SqliteTextVariantRepository } from '../candidate/sqliteTextVariantRepository';
import type { CandidateSnapshot } from '../data/candidateStore';
import { CandidateStoreConflictError } from '../data/store/errors';
import { applyBulletTranslation, pendingTranslation } from '../domain/experienceBulletLanguage';
import {
  arithmeticFails,
  buildFactRewriteRequest,
  checkFactRewrite,
  factRewriteDigest,
  InvalidBulletEditError,
  withBulletEdits,
  withOnlyBullets,
  type FactRewriteModelOutput,
  type FactRewriteProposal,
  type FactRewriteRequest,
} from '../domain/experienceFactRewrite';
import { withBulletVariant } from '../domain/factRewriteVariant';
import { EMPTY_RESUME_DRAFT, MAX_REWRITE_BULLETS, type ResumePendingFactRewrite } from '../domain/resumeDraft';
import type { ExperienceFactRewriter } from '../providers/experienceFactRewriter';
import type { RouteDeps } from './deps';
import { factRewriteSubject, registerFactRewriteVariantRoutes } from './factRewriteVariantRoutes';
import { registerFactRewordRoutes } from './factRewordRoutes';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

type Handler = (deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;

/**
 * The language of a place is not part of the digest: it is derived from the
 * profile text that already is, and a proposal kept before 01.11 must still
 * match so it is translated rather than written anew.
 */
const requestDigest = factRewriteDigest;

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

interface KeptProposal {
  readonly candidateId: string;
  readonly pending: ResumePendingFactRewrite;
  readonly request: FactRewriteRequest;
}

/**
 * The kept proposal; one in a language other than the profile's is translated
 * once and kept again under the same digest. On failure the candidate still
 * sees it, and the next opening tries again.
 */
async function keptProposal(
  deps: RouteDeps,
  running: RunningRewrites,
  { candidateId, pending, request }: KeptProposal,
  httpRequest: FastifyRequest,
): Promise<FactRewriteProposal> {
  const { digest, proposal } = pending;
  const translation = pendingTranslation(proposal, request);
  const rewriter = deps.experienceFactRewriter;
  if (!translation || !rewriter?.translate) return proposal;
  const translated = await running.produce(`${candidateId}:${digest}:${proposal.id}`, async () => {
    const output = await rewriter.translate?.(translation);
    return output ? applyBulletTranslation(proposal, translation, output, randomUUID()) : null;
  });
  if (!translated) {
    httpRequest.log.warn(
      { bullets: translation.bullets.length },
      'experience_fact_rewrite_translation_failed',
    );
    return proposal;
  }
  deps.candidateStore.saveFactRewriteProposal(
    candidateId,
    { digest, proposal: translated },
    (latest) =>
      digestOf(latest) === digest &&
      latest.resume?.draft.factRewriteProposal?.proposal.id === proposal.id,
  );
  httpRequest.log.info({ proposalId: translated.id }, 'experience_fact_rewrite_translated');
  return translated;
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
    const rewriter = deps.experienceFactRewriter;
    if (stored?.digest === digest) {
      const kept = { candidateId: candidate.id, pending: stored, request: rewriteRequest };
      return reply200(request, { proposal: await keptProposal(deps, running, kept, request) });
    }
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
  .object({
    edits: z.record(z.string().max(160), z.string().max(400).nullable()).optional(),
    /** Only these bullets are applied; with `only`, edits are not taken. */
    only: z.array(z.string().max(160)).min(1).max(MAX_REWRITE_BULLETS).optional(),
    /** B786: вариант единственного пункта из `only`; его текст берётся из хранилища. */
    variantId: z.string().max(80).optional(),
  })
  .strict()
  .refine((body) => !body.variantId || body.only?.length === 1)
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
  only: readonly string[] | undefined,
  variantText?: string,
): FactRewriteProposal | null {
  try {
    const [key] = only ?? [];
    if (key && variantText) return withBulletVariant(proposal, key, variantText);
    const edited = only ? withOnlyBullets(proposal, only) : withBulletEdits(proposal, edits);
    return edited.places.length ? edited : null;
  } catch (error) {
    if (error instanceof InvalidBulletEditError) return null;
    throw error;
  }
}

/** Текст сохранённого варианта; `null` — такого варианта у пункта нет. */
function variantTextOf(
  variants: SqliteTextVariantRepository,
  candidateId: string,
  proposalId: string,
  body: z.infer<typeof applyBody>,
): string | null | undefined {
  const [key] = body?.only ?? [];
  if (!body?.variantId || !key) return undefined;
  const { variants: stored } = variants.list(factRewriteSubject(candidateId, proposalId, key));
  return stored.find((variant) => variant.id === body.variantId)?.text ?? null;
}

/** The proposal of new facts or, B786, the rewording of a line (k06). */
function pendingById(snapshot: CandidateSnapshot, id: string): ResumePendingFactRewrite | null {
  const draft = snapshot.resume?.draft;
  return (
    [draft?.factRewriteProposal, draft?.factRewordProposal].find(
      (pending) => pending?.proposal.id === id,
    ) ?? null
  );
}

/** Variants of a rewording read their facts from memory: they are not the facts on offer. */
function variantSourceOf(snapshot: CandidateSnapshot, id: string) {
  const pending = pendingById(snapshot, id);
  const request = rewriteRequestOf(snapshot);
  if (pending?.digest !== requestDigest(request)) return null;
  if (pending !== snapshot.resume?.draft.factRewordProposal) {
    return { proposal: pending.proposal, request };
  }
  const wanted = new Set(pending.proposal.sourceFactIds);
  const facts = snapshot.memory
    .filter((item) => wanted.has(item.id))
    .map(({ id: factId, domain, statement }) => ({ id: factId, domain, statement }));
  return { proposal: pending.proposal, request: { ...request, facts } };
}

const handleApply = (variants: SqliteTextVariantRepository): Handler => async (deps, request, reply) => {
  const candidate = signedInCandidate(deps, request, reply);
  if (!candidate) return undefined;
  const { id } = idParams.parse(request.params);
  const body = applyBody.safeParse(request.body ?? undefined);
  if (!body.success) return editError(request, reply);
  const pending = pendingById(deps.candidateStore.getSnapshot(candidate.id), id);
  if (!pending) return staleError(request, reply);
  const variantText = variantTextOf(variants, candidate.id, id, body.data);
  if (variantText === null) return editError(request, reply);
  const proposal = editedProposal(pending.proposal, body.data?.edits ?? {}, body.data?.only, variantText);
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
  const variants = new SqliteTextVariantRepository({
    databasePath: deps.config.databasePath,
    encryptionKey: deps.config.dataEncryptionKey,
  });
  app.addHook('onClose', async () => variants.close());
  app.post('/api/v1/candidate/experience-fact-rewrite', withDeps(deps, proposeHandler(running)));
  app.post('/api/v1/candidate/experience-fact-rewrite/:id/apply', withDeps(deps, handleApply(variants)));
  app.post('/api/v1/candidate/experience-fact-rewrite/:id/revert', withDeps(deps, handleRevert));
  registerFactRewriteVariantRoutes(app, deps, {
    variants,
    current: (bound, candidateId, id) =>
      variantSourceOf(bound.candidateStore.getSnapshot(candidateId), id),
  });
  registerFactRewordRoutes(app, deps);
}
