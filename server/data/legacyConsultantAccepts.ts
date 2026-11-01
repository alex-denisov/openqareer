import type { ResumeDraft } from '../domain/resumeDraft';
import { FACT_REWRITE_COMMAND_PREFIX } from './factRewriteConfirmation';
import type { SqliteProfileChangeLogRepository } from './sqliteProfileChangeLogRepository';
import { factRewriteEdits } from '../domain/experienceFactRewrite';
import type {
  ProfileRevisionRecord,
  SqliteProfileRevisionRepository,
} from './sqliteProfileRevisionRepository';

/** What the snapshot needs to show «Подтверждено вами · с консультантом». */
export interface ConsultantTrust {
  /** Facts confirmed by a logged consultant accept, with its date. */
  readonly confirmations: ReadonlyMap<string, string>;
  /** Facts of places accepted before the change log existed: read as confirmed, with that date. */
  readonly legacy: ReadonlyMap<string, string>;
}

function placeFactIds(draft: ResumeDraft, experienceId: string): string[] {
  const entry = draft.experience.find((item) => item.id === experienceId);
  if (!entry) return [];
  return [
    entry.chronologyMemoryId,
    ...(entry.descriptionMemoryId ? [entry.descriptionMemoryId] : []),
    ...entry.bulletMemoryIds,
  ];
}

/**
 * Accepts made before 01.11 never wrote the candidate's confirmation. They are
 * read as confirmed instead of backfilled: a place keeps it while the accepted
 * consultant edit is in place, and nothing is written on read.
 */
export function consultantTrust(
  log: SqliteProfileChangeLogRepository,
  candidateId: string,
  draft: ResumeDraft | undefined,
  revisions: readonly ProfileRevisionRecord[],
): ConsultantTrust {
  const confirmations = log.consultantConfirmations(candidateId);
  if (!draft) return { confirmations, legacy: new Map() };
  const logged = log.commandIds(candidateId);
  const accepts = [
    ...(draft.factRewrites ?? []).flatMap((record) =>
      logged.has(`${FACT_REWRITE_COMMAND_PREFIX}${record.id}`)
        ? []
        : [...new Set(record.bullets.map((bullet) => bullet.experienceId))].map((id) => ({
            experienceId: id,
            at: record.appliedAt,
          })),
    ),
    ...revisions.flatMap((revision) =>
      revision.section === 'experience' &&
      revision.experienceId &&
      !revision.revertedAt &&
      !logged.has(revision.commandId)
        ? [{ experienceId: revision.experienceId, at: revision.createdAt }]
        : [],
    ),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const legacy = new Map(
    accepts.flatMap(({ experienceId, at }) =>
      placeFactIds(draft, experienceId).map((memoryId) => [memoryId, at] as const),
    ),
  );
  return { confirmations, legacy };
}

/** The consultant edits a snapshot marks (C58) and the trust they give the candidate's facts. */
export function consultantEditsAndTrust(
  revisionRepo: SqliteProfileRevisionRepository,
  log: SqliteProfileChangeLogRepository,
  candidateId: string,
  draft: ResumeDraft | undefined,
) {
  const revisions = revisionRepo.listRevisions(candidateId);
  return {
    edits: [...revisions, ...factRewriteEdits(draft)],
    trust: consultantTrust(log, candidateId, draft, revisions),
  };
}
