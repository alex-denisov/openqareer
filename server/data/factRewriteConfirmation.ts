import { randomUUID } from 'node:crypto';
import type { ResumeDraft, ResumeFactRewriteRecord } from '../domain/resumeDraft';
import type { SqliteProfileChangeLogRepository } from './sqliteProfileChangeLogRepository';

/** The history entry of an accepted consultant rewrite is found again by this key. */
export const FACT_REWRITE_COMMAND_PREFIX = 'fact-rewrite:';
const CANDIDATE_CONFIRMED = 'candidate-confirmed';

const commandIdOf = (rewriteId: string) => `${FACT_REWRITE_COMMAND_PREFIX}${rewriteId}`;

/**
 * Accepting consultant bullets is the candidate checking those workplaces:
 * every fact of each touched place becomes candidate-confirmed. The previous
 * trust of all of them is kept, so undoing the rewrite restores it, and the
 * consultant date reaches every fact the badge reads.
 */
export function confirmRewrittenPlaces(
  log: SqliteProfileChangeLogRepository,
  candidateId: string,
  draft: ResumeDraft,
  record: ResumeFactRewriteRecord,
): void {
  const placeIds = new Set(record.bullets.map((bullet) => bullet.experienceId));
  const places = draft.experience.filter((entry) => placeIds.has(entry.id));
  if (places.length === 0) return;
  const factIds = places.flatMap((entry) => [
    entry.chronologyMemoryId,
    ...(entry.descriptionMemoryId ? [entry.descriptionMemoryId] : []),
    ...entry.bulletMemoryIds,
  ]);
  const states = log.readFactStates(candidateId, factIds);
  log.writeFactStates(
    candidateId,
    states.map((state) => ({ ...state, status: 'confirmed', confidence: CANDIDATE_CONFIRMED })),
    record.appliedAt,
  );
  log.record({
    id: randomUUID(),
    candidateId,
    actor: 'consultant',
    section: 'experience',
    kind: 'confirmation',
    itemId: places.length === 1 ? places[0]!.id : null,
    label: places.map((entry) => [entry.title, entry.employer].filter(Boolean).join(' · ')).join('; '),
    previous: 'Не подтверждено вами',
    applied: 'Пункты консультанта приняты, место подтверждено вами',
    commandId: commandIdOf(record.id),
    factStates: states,
    createdAt: record.appliedAt,
  });
}

/** Undoing a rewrite gives the place back the trust it had before the accept. */
export function restoreRewrittenPlaces(
  log: SqliteProfileChangeLogRepository,
  candidateId: string,
  rewriteId: string,
): void {
  const entry = log.getByCommandId(candidateId, commandIdOf(rewriteId));
  if (!entry || entry.revertedAt) return;
  const revertedAt = new Date().toISOString();
  log.writeFactStates(candidateId, entry.factStates, revertedAt);
  log.markReverted(candidateId, entry.id, revertedAt);
}
