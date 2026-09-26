import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { ResumeEvidenceSnapshot } from '../domain/resumeStudio';
import { resumeDraftSchema, type ResumeDraft } from '../domain/resumeDraft';
import type { ResumeReaderProvenance, StoredResumeDraft } from './candidateStore';
import type { SealedText } from './sealedText';

interface ResumeRow {
  draft_cipher: string;
  evidence_snapshot_cipher: string;
  created_at: string;
  updated_at: string;
}

type SealedField = 'draft' | 'evidence-snapshot';

interface StoredResumeEnvelope {
  readonly draft: ResumeDraft;
  readonly reader: ResumeReaderProvenance | null;
}

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

const readerSchema = z
  .object({
    method: z.enum(['model', 'rules']),
    model: z.string().min(1).max(200).nullable(),
    promptRevision: z.string().min(1).max(100).nullable(),
    readAt: z.string().datetime(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.method === 'model' && (!value.model || !value.promptRevision)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'model provenance requires id and prompt revision' });
    }
    if (value.method === 'rules' && (value.model !== null || value.promptRevision !== null)) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'rules provenance has no model metadata' });
    }
  });

const storedResumeEnvelopeSchema = z
  .object({ draft: resumeDraftSchema, reader: readerSchema.nullable() })
  .strict();

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
    reader?: ResumeReaderProvenance | null,
  ): StoredResumeDraft {
    const parsedDraft = resumeDraftSchema.parse(draft);
    const parsedSnapshot = evidenceSnapshotSchema.parse(evidenceSnapshot);
    const parsedReader = reader === undefined ? this.get(candidateId)?.reader ?? null : readerSchema.nullable().parse(reader);
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
        this.seal(candidateId, 'draft', { draft: parsedDraft, reader: parsedReader }),
        this.seal(candidateId, 'evidence-snapshot', parsedSnapshot),
        now,
        now,
      ) as Pick<ResumeRow, 'created_at' | 'updated_at'>;
    return {
      draft: parsedDraft,
      evidenceSnapshot: parsedSnapshot,
      reader: parsedReader,
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
    const stored = readStoredResume(this.open(candidateId, 'draft', row.draft_cipher));
    return {
      draft: stored.draft,
      evidenceSnapshot: evidenceSnapshotSchema.parse(
        this.open(candidateId, 'evidence-snapshot', row.evidence_snapshot_cipher),
      ),
      reader: stored.reader,
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

/** Rows before B184 stored the bare draft: treating it as unknown avoids a false model claim. */
function readStoredResume(value: unknown): StoredResumeEnvelope {
  const legacy = resumeDraftSchema.safeParse(value);
  if (legacy.success) return { draft: legacy.data, reader: null };
  return storedResumeEnvelopeSchema.parse(value);
}

function associatedData(candidateId: string, field: SealedField): string {
  return `candidate:${candidateId}:resume:${field}`;
}
