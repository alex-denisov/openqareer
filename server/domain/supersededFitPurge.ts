/**
 * 23.11: 18.5K superseded fit jobs (`failed / profile_changed`, 2 GB of sealed input) left before
 * `discard`. Since #939 the worker is not restarted on every deploy, so the rows go in hourly
 * passes of small batches with a pause between them, until none are left or the worker stops.
 */
export const SUPERSEDED_PURGE_PASS_ROWS = 5000;
export const SUPERSEDED_PURGE_EVERY_MS = 60 * 60_000;
export const SUPERSEDED_PURGE_PAUSE_MS = 50;

export interface SupersededPurgeDeps {
  /** Deletes one small batch and returns how many rows went. */
  readonly batch: () => number;
  /** Resolves early when the worker stops. */
  readonly sleep: (ms: number) => Promise<void>;
  readonly stopping: () => boolean;
  readonly log: (removed: number) => void;
  /** A failed batch (a busy database): the pass ends and the next hour tries again. */
  readonly warn: (error: unknown) => void;
}

export interface SupersededPurgePass {
  readonly removed: number;
  readonly failed: boolean;
}

/** One pass: at most `limit` rows, a pause after every batch, cut short by a stop or a failed batch. */
export async function purgeSupersededPass(
  deps: SupersededPurgeDeps,
  limit = SUPERSEDED_PURGE_PASS_ROWS,
): Promise<SupersededPurgePass> {
  let removed = 0;
  while (removed < limit && !deps.stopping()) {
    let batch: number;
    try {
      batch = deps.batch();
    } catch (error) {
      deps.warn(error);
      return { removed, failed: true };
    }
    if (batch === 0) break;
    removed += batch;
    await deps.sleep(SUPERSEDED_PURGE_PAUSE_MS);
  }
  return { removed, failed: false };
}

/** Passes every hour while a full or failed pass leaves rows; a short clean pass means none are left. */
export async function runSupersededPurge(
  deps: SupersededPurgeDeps,
  every = SUPERSEDED_PURGE_EVERY_MS,
): Promise<void> {
  while (!deps.stopping()) {
    const pass = await purgeSupersededPass(deps);
    if (pass.removed > 0) deps.log(pass.removed);
    if (!pass.failed && pass.removed < SUPERSEDED_PURGE_PASS_ROWS) return;
    await deps.sleep(every);
  }
}
