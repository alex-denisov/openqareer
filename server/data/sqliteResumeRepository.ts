import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ResumeEvidenceSnapshot } from '../domain/resumeStudio';
import { resumeDraftSchema, type ResumeDraft } from '../domain/resumeDraft';
import type { StoredResumeDraft } from './candidateStore';
import type { SealedText } from './sealedText';

interface ResumeRow {
  draft_cipher: string;
  evidence_snapshot_cipher: string;
  created_at: string;
  updated_at: string;
}

type SealedField = 'draft' | 'evidence-snapshot';

const evidenceSnapshotSchema = z
  .array(
    z
      .object({
        memoryId: z.string().min(1).max(80),
        statement: z.string().min(1).max(1_000),
        sourceMessageIds: z.array(z.string().min(1).max(80)).max(20),
      })
      .strict(),
  )
  .max(200);

/**
 * Stores the candidate-entered resume draft and the evidence snapshot approved
 * with it. Both are sealed with candidate-scoped associated data so a row can
 * never be replayed under another candidate.
 */
export class SqliteResumeRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  save(
    candidateId: string,
    draft: ResumeDraft,
    evidenceSnapshot: readonly ResumeEvidenceSnapshot[],
  ): StoredResumeDraft {
    const parsedDraft = resumeDraftSchema.parse(draft);
    const parsedSnapshot = evidenceSnapshotSchema.parse(evidenceSnapshot);
    const now = new Date().toISOString();
    const written = this.database
      .prepare(
        `INSERT INTO resume_drafts
          (candidate_id, draft_cipher, evidence_snapshot_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           draft_cipher = excluded.draft_cipher,
           evidence_snapshot_cipher = excluded.evidence_snapshot_cipher,
           updated_at = excluded.updated_at
         RETURNING created_at, updated_at`,
      )
      .get(
        candidateId,
        this.seal(candidateId, 'draft', parsedDraft),
        this.seal(candidateId, 'evidence-snapshot', parsedSnapshot),
        now,
        now,
      ) as Pick<ResumeRow, 'created_at' | 'updated_at'>;
    return {
      draft: parsedDraft,
      evidenceSnapshot: parsedSnapshot,
      createdAt: written.created_at,
      updatedAt: written.updated_at,
    };
  }

  get(candidateId: string): StoredResumeDraft | null {
    const row = this.database
      .prepare(
        `SELECT draft_cipher, evidence_snapshot_cipher, created_at, updated_at
         FROM resume_drafts WHERE candidate_id = ?`,
      )
      .get(candidateId) as ResumeRow | undefined;
    if (!row) return null;
    return {
      draft: resumeDraftSchema.parse(
        this.open(candidateId, 'draft', row.draft_cipher),
      ),
      evidenceSnapshot: evidenceSnapshotSchema.parse(
        this.open(candidateId, 'evidence-snapshot', row.evidence_snapshot_cipher),
      ),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private seal(candidateId: string, field: SealedField, value: unknown): string {
    return this.sealedText.seal(
      JSON.stringify(value),
      associatedData(candidateId, field),
    );
  }

  private open(
    candidateId: string,
    field: SealedField,
    value: string,
  ): unknown {
    return JSON.parse(
      this.sealedText.open(value, associatedData(candidateId, field)),
    ) as unknown;
  }
}

function associatedData(candidateId: string, field: SealedField): string {
  return `candidate:${candidateId}:resume:${field}`;
}
