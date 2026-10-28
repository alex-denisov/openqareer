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
export function selectionToCount(items: readonly MatchedVacancyItem[]): string[] {
  return items
    .filter((item) => vacancyFitStage(item.explanation.fitView) === 'counting')
    .map((item) => item.cluster.id);
}

type Preload = (vacancyIds: readonly string[]) => Promise<unknown>;
type RequestFit = (clusterIds: readonly string[]) => void;

export function createSelectionFitSweep({
  chunk = SWEEP_CHUNK,
  windowMs = SWEEP_WINDOW_MS,
  now = Date.now,
}: { chunk?: number; windowMs?: number; now?: () => number } = {}) {
  const startedAt = new Map<string, number>();
  return async function sweep(
    candidateId: string,
    clusterIds: readonly string[],
    preload: Preload,
    requestFit: RequestFit,
  ): Promise<void> {
    const last = startedAt.get(candidateId);
    if (last !== undefined && now() - last < windowMs) return;
    startedAt.set(candidateId, now());
    for (let start = 0; start < clusterIds.length; start += chunk) {
      const ids = clusterIds.slice(start, start + chunk);
      // The fit is queued after the text is read: queued earlier it would see no description.
      await preload(ids.map((id) => id.replace(/^cluster-/u, ''))).catch(() => undefined);
      try {
        requestFit(ids);
      } catch {
        // One failed queue write leaves the next chunks to this sweep and the rest to the next.
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  };
}

export const sweepSelectionFit = createSelectionFitSweep();
