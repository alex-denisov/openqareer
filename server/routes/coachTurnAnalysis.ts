import type { FastifyRequest } from 'fastify';
import type { CoachTurnInput, CoachTurnResult } from '../domain/coach';
import { CoachProviderError } from '../providers/coachProvider';
import type { RouteDeps } from './deps';
import { recordNotificationFromSource } from './notificationRepositoryAccess';

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

/** The reply keeps its words; the analysis adds the track, proposals and what is still unknown. */
export function mergeAnalysis(reply: CoachTurnResult, analysis: CoachTurnResult): CoachTurnResult {
  return {
    ...reply,
    analysis: 'ready',
    careerTrack: analysis.careerTrack ?? reply.careerTrack,
    actionProposals: uniqueBy([...reply.actionProposals, ...analysis.actionProposals], (proposal) =>
      JSON.stringify(proposal),
    ).slice(0, 20),
    completeness: {
      known: [...new Set([...reply.completeness.known, ...analysis.completeness.known])].slice(
        0,
        20,
      ),
      unknown: [
        ...new Set([...reply.completeness.unknown, ...analysis.completeness.unknown]),
      ].slice(0, 20),
    },
    ...(analysis.intelligence ? { intelligence: analysis.intelligence } : {}),
  };
}

/**
 * 28.10 (owner): the consultant answers first; the expert and strategist run here,
 * after the reply is stored, and their proposals join the same turn.
 */
export async function runTurnAnalysis(
  deps: RouteDeps,
  request: FastifyRequest,
  candidateId: string,
  key: string,
  input: CoachTurnInput,
): Promise<void> {
  const update = deps.candidateStore.updateCoachTurnResult?.bind(deps.candidateStore);
  if (!update) return;
  try {
    const analysis = await deps.coachProvider.createTurn(input, key, { split: 'analysis' });
    let proposals = 0;
    update(candidateId, key, (reply) => {
      const merged = mergeAnalysis(reply, analysis.result);
      proposals = merged.actionProposals.length;
      return merged;
    });
    if (proposals > 0) {
      recordNotificationFromSource(deps, request, candidateId, {
        kind: 'consultant_edits',
        sourceType: 'coach_turn',
        sourceId: key,
        idempotencyKey: `consultant-edits:${key}`,
      });
    }
  } catch (error) {
    request.log.warn(
      { code: error instanceof CoachProviderError ? error.code : 'internal_error' },
      'coach-turn-analysis-failed',
    );
    update(candidateId, key, (reply) => ({ ...reply, analysis: 'failed' }));
  }
}

/**
 * The analysis runs inside the server process: a deploy or crash can drop it
 * and leave the turn `pending` forever (CPO 28.10). A pending analysis older
 * than five minutes is read as failed.
 */
export const ANALYSIS_STALE_MS = 5 * 60_000;

export function withStaleAnalysis<T extends { analysis?: string; analysisStartedAt?: string }>(
  result: T,
  now: number = Date.now(),
): T {
  if (result.analysis !== 'pending' || !result.analysisStartedAt) return result;
  const started = Date.parse(result.analysisStartedAt);
  return Number.isNaN(started) || now - started <= ANALYSIS_STALE_MS
    ? result
    : { ...result, analysis: 'failed' };
}
