import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';
import {
  candidateWorkspaceSchema,
  readStoredCandidateWorkspace,
  type CandidateWorkspaceState,
} from '../domain/candidateWorkspace';
import { VISIT_DEBOUNCE_MS, type RecordVisitResult } from './sqliteCandidateVisitRepository';

interface WorkspaceRow {
  workspace_cipher: string;
  updated_at: string;
}

/**
 * Holds the answers the candidate gave the diagnostic wizard.
 *
 * They used to live only in browser storage, so signing out erased the
 * candidate's career context and signing back in restarted the diagnostic with
 * every section locked — while this same database still held their resume and
 * confirmed facts (INC-024). Browser storage is a cache; this is the record.
 */
export class SqliteWorkspaceRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  save(candidateId: string, workspace: CandidateWorkspaceState): CandidateWorkspaceState {
    const parsed = candidateWorkspaceSchema.parse(workspace);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO candidate_workspaces
          (candidate_id, workspace_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           workspace_cipher = excluded.workspace_cipher,
           updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        this.sealedText.seal(JSON.stringify(parsed), associatedData(candidateId)),
        now,
        now,
      );
    return parsed;
  }

  get(candidateId: string): CandidateWorkspaceState | null {
    const row = this.database
      .prepare(
        `SELECT workspace_cipher, updated_at FROM candidate_workspaces WHERE candidate_id = ?`,
      )
      .get(candidateId) as WorkspaceRow | undefined;
    if (!row) return null;
    return readStoredCandidateWorkspace(
      JSON.parse(
        this.sealedText.open(row.workspace_cipher, associatedData(candidateId)),
      ) as unknown,
    );
  }

  /**
   * Stores visit marks in the encrypted workspace JSON without adding a
   * database column. `legacyLastVisitedAt` bridges candidates who visited
   * before this field was introduced.
   */
  recordVisit(
    candidateId: string,
    now: string,
    legacyLastVisitedAt: string | null,
  ): RecordVisitResult | null {
    const current = this.get(candidateId);
    if (!current) return null;

    const lastVisitedAt = current.lastVisitedAt ?? legacyLastVisitedAt;
    if (!lastVisitedAt) {
      this.save(candidateId, { ...current, lastVisitedAt: now, previousVisitedAt: now });
      return { since: null };
    }

    const elapsedMs = Date.parse(now) - Date.parse(lastVisitedAt);
    if (elapsedMs >= VISIT_DEBOUNCE_MS) {
      this.save(candidateId, { ...current, lastVisitedAt: now, previousVisitedAt: lastVisitedAt });
      return { since: lastVisitedAt };
    }

    if (current.lastVisitedAt === undefined) {
      this.save(candidateId, {
        ...current,
        lastVisitedAt,
        previousVisitedAt: current.previousVisitedAt ?? lastVisitedAt,
      });
    }
    return { since: current.previousVisitedAt ?? lastVisitedAt };
  }

  getSinceLastVisit(candidateId: string): string | null {
    const current = this.get(candidateId);
    return current?.previousVisitedAt ?? current?.lastVisitedAt ?? null;
  }
}

/** Candidate-scoped, so a row can never be replayed under another candidate. */
function associatedData(candidateId: string): string {
  return `candidate:${candidateId}:workspace`;
}
