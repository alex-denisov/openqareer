import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import {
  resumeVersionContentSchema,
  type ResumeVersionContent,
  type ResumeVersionCreateResult,
  type ResumeVersionCursor,
  type ResumeVersionPage,
  type ResumeVersionUpdateResult,
  type StoredResumeVersion,
} from '../domain/resumeVersions';
import type { SealedText } from './sealedText';

interface ResumeVersionRow {
  readonly candidate_id: string;
  readonly version_id: string;
  readonly revision: number;
  readonly source_master_revision: string;
  readonly content_cipher: string;
  readonly created_at: string;
  readonly updated_at: string;
}

const sealedRecordSchema = z.object({
  schemaVersion: z.literal(1),
  content: resumeVersionContentSchema,
});

export class SqliteResumeVersionRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  create(
    candidateId: string,
    versionId: string,
    sourceMasterRevision: string,
    content: ResumeVersionContent,
  ): ResumeVersionCreateResult {
    const parsedContent = resumeVersionContentSchema.parse(content);
    if (parsedContent.status !== 'draft') {
      throw new Error('new resume versions must start as drafts');
    }
    const parsedMasterRevision = z.string().min(1).max(128).parse(sourceMasterRevision);
    const now = new Date().toISOString();
    const cipher = this.seal(candidateId, versionId, parsedContent);
    const result = this.database
      .prepare(
        [
          'INSERT OR IGNORE INTO candidate_resume_versions',
          '(candidate_id, version_id, revision, source_master_revision, content_cipher, created_at, updated_at)',
          'VALUES (?, ?, 1, ?, ?, ?, ?)',
        ].join(' '),
      )
      .run(candidateId, versionId, parsedMasterRevision, cipher, now, now);

    if (Number(result.changes) === 1) {
      const version = this.get(candidateId, versionId);
      if (!version) throw new Error('created resume version could not be reloaded');
      return { status: 'created', version };
    }

    const existing = this.get(candidateId, versionId);
    if (
      existing &&
      existing.sourceMasterRevision === parsedMasterRevision &&
      canonicalJson(contentOf(existing)) === canonicalJson(parsedContent)
    ) {
      return { status: 'replayed', version: existing };
    }
    return { status: 'id_conflict' };
  }

  get(candidateId: string, versionId: string): StoredResumeVersion | null {
    const row = this.database
      .prepare(
        [
          'SELECT candidate_id, version_id, revision, source_master_revision,',
          'content_cipher, created_at, updated_at',
          'FROM candidate_resume_versions WHERE candidate_id = ? AND version_id = ?',
        ].join(' '),
      )
      .get(candidateId, versionId) as ResumeVersionRow | undefined;
    return row ? this.open(row) : null;
  }

  list(
    candidateId: string,
    options: { readonly limit: number; readonly cursor: ResumeVersionCursor | null },
  ): ResumeVersionPage {
    const limit = Math.max(1, Math.min(50, Math.floor(options.limit)));
    const countRow = this.database
      .prepare(
        'SELECT COUNT(*) AS total_count FROM candidate_resume_versions WHERE candidate_id = ?',
      )
      .get(candidateId) as { readonly total_count?: number } | undefined;
    const rows = options.cursor
      ? (this.database
          .prepare(
            [
              'SELECT candidate_id, version_id, revision, source_master_revision,',
              'content_cipher, created_at, updated_at',
              'FROM candidate_resume_versions',
              'WHERE candidate_id = ? AND',
              '(updated_at < ? OR (updated_at = ? AND version_id < ?))',
              'ORDER BY updated_at DESC, version_id DESC LIMIT ?',
            ].join(' '),
          )
          .all(
            candidateId,
            options.cursor.updatedAt,
            options.cursor.updatedAt,
            options.cursor.versionId,
            limit + 1,
          ) as unknown as ResumeVersionRow[])
      : (this.database
          .prepare(
            [
              'SELECT candidate_id, version_id, revision, source_master_revision,',
              'content_cipher, created_at, updated_at',
              'FROM candidate_resume_versions WHERE candidate_id = ?',
              'ORDER BY updated_at DESC, version_id DESC LIMIT ?',
            ].join(' '),
          )
          .all(candidateId, limit + 1) as unknown as ResumeVersionRow[]);
    const hasMore = rows.length > limit;
    const selected = hasMore ? rows.slice(0, limit) : rows;
    const items = selected.map((row) => this.open(row));
    const last = items.at(-1);
    return {
      items,
      totalCount: Number(countRow?.total_count ?? 0),
      nextCursor:
        hasMore && last ? { updatedAt: last.updatedAt, versionId: last.id } : null,
    };
  }

  update(
    candidateId: string,
    versionId: string,
    expectedRevision: number,
    expectedMasterRevision: string,
    content: ResumeVersionContent,
  ): ResumeVersionUpdateResult {
    const existing = this.get(candidateId, versionId);
    if (!existing) return { status: 'not_found' };
    if (existing.revision !== expectedRevision) return { status: 'revision_conflict' };
    if (existing.sourceMasterRevision !== expectedMasterRevision) {
      return { status: 'source_conflict' };
    }

    const parsedContent = resumeVersionContentSchema.parse(content);
    if (existing.status === 'sent' || parsedContent.status === 'sent') {
      return { status: 'immutable' };
    }
    if (parsedContent.status === 'approved') {
      const existingContent = contentOf(existing);
      const unchanged = existing.status === 'draft'
        && parsedContent.title === existingContent.title
        && canonicalJson(parsedContent.requirements) === canonicalJson(existingContent.requirements)
        && canonicalJson(parsedContent.snapshot) === canonicalJson(existingContent.snapshot);
      if (!unchanged) return { status: 'immutable' };
    } else if (parsedContent.status !== 'draft') {
      return { status: 'immutable' };
    }

    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        [
          'UPDATE candidate_resume_versions',
          'SET revision = revision + 1, content_cipher = ?, updated_at = ?',
          'WHERE candidate_id = ? AND version_id = ? AND revision = ?',
          'AND source_master_revision = ?',
        ].join(' '),
      )
      .run(
        this.seal(candidateId, versionId, parsedContent),
        now,
        candidateId,
        versionId,
        expectedRevision,
        expectedMasterRevision,
      );
    if (Number(result.changes) !== 1) return { status: 'revision_conflict' };
    const updated = this.get(candidateId, versionId);
    if (!updated) throw new Error('updated resume version could not be reloaded');
    return { status: 'updated', version: updated };
  }

  private seal(candidateId: string, versionId: string, content: ResumeVersionContent): string {
    return this.sealedText.seal(
      JSON.stringify({ schemaVersion: 1, content }),
      associatedData(candidateId, versionId),
    );
  }

  private open(row: ResumeVersionRow): StoredResumeVersion {
    const envelope = sealedRecordSchema.parse(
      JSON.parse(
        this.sealedText.open(
          row.content_cipher,
          associatedData(row.candidate_id, row.version_id),
        ),
      ),
    );
    return {
      ...envelope.content,
      id: row.version_id,
      revision: row.revision,
      sourceMasterRevision: row.source_master_revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function contentOf(version: StoredResumeVersion): ResumeVersionContent {
  return {
    title: version.title,
    requirements: version.requirements,
    status: version.status,
    snapshot: version.snapshot,
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalJson(item)).join(',') + ']';
  }
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return '{' + entries
      .map(([key, item]) => JSON.stringify(key) + ':' + canonicalJson(item))
      .join(',') + '}';
  }
  return JSON.stringify(value) ?? 'null';
}

function associatedData(candidateId: string, versionId: string): string {
  return 'candidate:' + candidateId + ':resume-version:' + versionId;
}
