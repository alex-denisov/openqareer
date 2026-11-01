import { vacancyFitStage } from '../../shared/vacancyFitPercent';
import type { MatchedVacancyItem } from '../vacancies/multiSourceVacancyEngine';

/** Rows per step: one text read batch (hh: one request a second) and one queue write. */
const SWEEP_CHUNK = 20;
/** One sweep per candidate per window; a list read inside it does not start another. */
const SWEEP_WINDOW_MS = 10 * 60_000;

/**
 * CPO 28.10 evening: the whole selection is counted in the background, highest role
 * relevance first, until every row with text has a percent. Rows still counting keep the
 * selection's relevance order (shared compareFitPercent leaves their order to the caller).
 */
/** B580: Free counts the 300 most relevant rows; the rest are counted when a card is opened. */
export const FREE_SELECTION_FIT_LIMIT = 300;

export function selectionFitLimit(plan: 'free' | 'basic' | 'pro' | 'max'): number {
  return plan === 'free' ? FREE_SELECTION_FIT_LIMIT : Number.POSITIVE_INFINITY;
}

export function selectionToCount(
  items: readonly MatchedVacancyItem[],
  limit = Number.POSITIVE_INFINITY,
): string[] {
  return items
    .slice(0, limit)
    .filter((item) => vacancyFitStage(item.explanation.fitView) === 'counting')
    .map((item) => item.cluster.id);
}

/** Cheap order-sensitive digest of the ids still to count: the gate only compares it. */
export function selectionStamp(clusterIds: readonly string[]): string {
  let hash = 0;
  for (const id of clusterIds) {
    for (let index = 0; index < id.length; index += 1) {
      hash = (Math.imul(hash, 31) + id.charCodeAt(index)) | 0;
    }
  }
  return `${clusterIds.length}:${hash >>> 0}`;
}

/** `rank` — the chunk's first place in the selection. */
type Preload = (vacancyIds: readonly string[], rank: number) => Promise<unknown> | unknown;
/** `rank` is the chunk's first place in the selection: the queue keeps relevance order (B580). */
type RequestFit = (clusterIds: readonly string[], rank: number) => void;

/**
 * 01.11: one sweep per candidate and selection key (profile stamp + the whole filtered
 * selection) per window. A new key starts at once and stops the older sweep; the same key
 * inside the window does not start another.
 */
export function createSelectionFitSweep({
  chunk = SWEEP_CHUNK,
  windowMs = SWEEP_WINDOW_MS,
  now = Date.now,
}: { chunk?: number; windowMs?: number; now?: () => number } = {}) {
  const started = new Map<string, { readonly at: number; readonly key: string }>();
  return async function sweep(
    candidateId: string,
    clusterIds: readonly string[],
    preload: Preload,
    requestFit: RequestFit,
    selectionKey = '',
  ): Promise<void> {
    const last = started.get(candidateId);
    if (last !== undefined && last.key === selectionKey && now() - last.at < windowMs) return;
    const mine = { at: now(), key: selectionKey };
    started.set(candidateId, mine);
    for (let start = 0; start < clusterIds.length; start += chunk) {
      if (started.get(candidateId) !== mine) return;
      const ids = clusterIds.slice(start, start + chunk);
      try {
        await preload(
          ids.map((id) => id.replace(/^cluster-/u, '')),
          start,
        );
      } catch {
        // A failed text request leaves the row to the background loader.
      }
      try {
        requestFit(ids, start);
      } catch {
        // One failed queue write leaves the next chunks to this sweep and the rest to the next.
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}

export const sweepSelectionFit = createSelectionFitSweep();
