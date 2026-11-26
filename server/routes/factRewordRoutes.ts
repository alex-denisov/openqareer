import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { CandidateSnapshot } from '../data/candidateStore';
import { writeCheckedVariant } from '../domain/checkedVariant';
import {
  buildFactRewriteRequest,
  factRewriteDigest,
  type FactRewriteProposal,
} from '../domain/experienceFactRewrite';
import { checkFactRewriteVariant } from '../domain/factRewriteVariant';
import { rewordProposal, rewordRequest, rewordTarget, type RewordTarget } from '../domain/factReword';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import type { RouteDeps } from './deps';
import {
  authenticateCandidate,
  csrfError,
  hasSafeMutationOrigin,
  sendError,
  withDeps,
} from './helpers';

/**
 * B786 (k06): новая формулировка первой строки места. Готовится до ответа консультанта, чтобы он
 * обещал правку только когда она есть; кабинет берёт её тем же адресом, сохранённую — без модели.
 */
export type RewordResult =
  | { readonly state: 'ready'; readonly proposal: FactRewriteProposal; readonly before: string }
  | { readonly state: 'none' }
  | { readonly state: 'failed' };

function digestOf(snapshot: CandidateSnapshot): string {
  const draft = snapshot.resume?.draft ?? EMPTY_RESUME_DRAFT;
  return factRewriteDigest(buildFactRewriteRequest(draft, snapshot.memory));
}

/** Цель сохранённой правки, если строка и факты места те же, что при её подготовке. */
export function keptRewordTarget(
  snapshot: CandidateSnapshot,
  proposal: FactRewriteProposal,
): RewordTarget | null {
  const place = proposal.places[0];
  const draft = snapshot.resume?.draft;
  const target = place && draft ? rewordTarget(draft, snapshot.memory, place.experienceId) : null;
  if (!target || place?.bullets[0]?.replacesMemoryId !== target.memoryId) return null;
  const ids = target.facts.map((item) => item.id);
  const same =
    ids.length === proposal.sourceFactIds.length &&
    ids.every((id) => proposal.sourceFactIds.includes(id));
  return same ? target : null;
}

function keptFor(snapshot: CandidateSnapshot, target: RewordTarget): FactRewriteProposal | null {
  const kept = snapshot.resume?.draft.factRewordProposal;
  if (kept?.digest !== digestOf(snapshot)) return null;
  const same = keptRewordTarget(snapshot, kept.proposal);
  return same?.experienceId === target.experienceId ? kept.proposal : null;
}

async function writeReword(
  deps: RouteDeps,
  target: RewordTarget,
  log: FastifyRequest['log'] | undefined,
): Promise<string | null> {
  const rewriter = deps.experienceFactRewriter;
  if (!rewriter?.rewriteVariant) return null;
  const input = rewordRequest(target);
  return writeCheckedVariant({
    request: input,
    write: async (asked) => (await rewriter.rewriteVariant?.(asked)) ?? null,
    check: (output, onReject) => checkFactRewriteVariant(input, output, onReject),
    onReject: (reason, attempt) => log?.info({ reason, attempt }, 'fact_reword_rejected'),
  });
}

/** Правка строки места: сохранённая, если факты и места не менялись, иначе новая от модели. */
export async function prepareReword(
  deps: RouteDeps,
  candidateId: string,
  experienceId: string,
  log?: FastifyRequest['log'],
): Promise<RewordResult> {
  const snapshot = deps.candidateStore.getSnapshot(candidateId);
  const draft = snapshot.resume?.draft;
  const target = draft ? rewordTarget(draft, snapshot.memory, experienceId) : null;
  if (!target) return { state: 'none' };
  const kept = keptFor(snapshot, target);
  if (kept) return { state: 'ready', proposal: kept, before: target.current };
  try {
    const text = await writeReword(deps, target, log);
    if (!text) return { state: 'failed' };
    const digest = digestOf(snapshot);
    const proposal = rewordProposal(target, text, randomUUID());
    deps.candidateStore.saveFactRewriteProposal(
      candidateId,
      { digest, proposal },
      (latest) => digestOf(latest) === digest,
      'factRewordProposal',
    );
    return { state: 'ready', proposal, before: target.current };
  } catch (error) {
    const failureType = error instanceof Error ? error.name : 'UnknownError';
    log?.warn({ failureType }, 'fact_reword_failed');
    return { state: 'failed' };
  }
}

const body = z.object({ experienceId: z.string().trim().min(1).max(120) }).strict();

async function handleReword(deps: RouteDeps, request: FastifyRequest, reply: FastifyReply) {
  if (!hasSafeMutationOrigin(request, deps.config)) return csrfError(request, reply);
  const candidate = authenticateCandidate(
    request,
    reply,
    deps.candidateStore,
    deps.authService,
    deps.config,
  );
  if (!candidate) return undefined;
  const parsed = body.safeParse(request.body ?? {});
  if (!parsed.success) {
    return sendError(reply, request, 400, 'invalid_place', 'Проверьте место работы.', false);
  }
  const result = await prepareReword(deps, candidate.id, parsed.data.experienceId, request.log);
  if (result.state === 'failed') {
    request.log.warn('fact_reword_failed');
    return sendError(
      reply,
      request,
      502,
      'reword_failed',
      'Не получилось подготовить правку. Попробуйте ещё раз.',
      true,
    );
  }
  const data =
    result.state === 'ready'
      ? { proposal: result.proposal, before: result.before }
      : { proposal: null };
  return { data, meta: { requestId: request.id } };
}

export function registerFactRewordRoutes(app: FastifyInstance, deps: RouteDeps): void {
  app.post('/api/v1/candidate/experience-fact-rewrite/reword', withDeps(deps, handleReword));
}
