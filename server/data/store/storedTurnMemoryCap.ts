/** The turn schema allows 20 memory candidates. */
const STORED_MEMORY_CANDIDATE_LIMIT = 20;

/**
 * 26.10: the fact step plus the roles stored a turn with more than 20 candidates, and every
 * read of that candidate (`/me`, memory, turns) failed validation. The facts themselves live
 * in the memory table; the turn record only keeps the first 20 of them.
 */
export function withStoredMemoryCap(stored: unknown): unknown {
  if (!stored || typeof stored !== 'object') return stored;
  const record = stored as { memoryCandidates?: unknown };
  if (!Array.isArray(record.memoryCandidates)) return stored;
  if (record.memoryCandidates.length <= STORED_MEMORY_CANDIDATE_LIMIT) return stored;
  return {
    ...record,
    memoryCandidates: record.memoryCandidates.slice(0, STORED_MEMORY_CANDIDATE_LIMIT),
  };
}
