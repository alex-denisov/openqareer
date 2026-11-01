import type { CandidateStore, CandidateSnapshot } from '../data/candidateStore';
import { FACT_REWRITE_COMMAND_PREFIX, rewriteHistoryText } from '../data/factRewriteConfirmation';
import type { ProfileHistoryItem } from './profileHistory';

/** History id of a consultant rewrite accepted before the change log existed. */
export const LEGACY_REWRITE_PREFIX = 'rewrite:';

/**
 * Consultant bullets accepted in «Опыт» before 01.11 live only on the draft
 * (`factRewrites`). They join the history read-only; «Вернуть» undoes the rewrite.
 */
export function legacyRewriteItems(
  store: CandidateStore,
  candidateId: string,
  snapshot: CandidateSnapshot,
): ProfileHistoryItem[] {
  const draft = snapshot.resume?.draft;
  const records = draft?.factRewrites ?? [];
  if (!draft || records.length === 0) return [];
  const logged = store.profileChangeLog.commandIds(candidateId);
  const statements = new Map(snapshot.memory.map((item) => [item.id, item.statement]));
  return records
    .filter((record) => !logged.has(`${FACT_REWRITE_COMMAND_PREFIX}${record.id}`))
    .map((record) => {
      const placeIds = new Set(record.bullets.map((bullet) => bullet.experienceId));
      const places = draft.experience.filter((entry) => placeIds.has(entry.id));
      const texts = record.bullets.flatMap((bullet) => statements.get(bullet.memoryId) ?? []);
      const label = places
        .map((entry) => [entry.title, entry.employer].filter(Boolean).join(' · '))
        .join('; ');
      return {
        id: `${LEGACY_REWRITE_PREFIX}${record.id}`,
        actor: 'consultant',
        section: 'experience',
        kind: 'confirmation',
        itemId: places.length === 1 ? places[0]!.id : null,
        label,
        previousText: '',
        ...rewriteHistoryText(label, texts),
        createdAt: record.appliedAt,
        revertedAt: null,
      };
    });
}
