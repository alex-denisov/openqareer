import { DatabaseSync } from 'node:sqlite';
import { MIGRATION_37 } from './profileRevisionSchema';
import type { SealedText } from './sealedText';

export type ProfileRevisionSection = 'headline' | 'about' | 'experience' | 'skills';

/**
 * The 37th-migration CHECK only allows three sections and the production table
 * cannot be altered inside the deploy window, so a skill revision is stored as
 * an 'experience' row whose entry id carries this prefix.
 */
const SKILL_KEY_PREFIX = 'skill:';

export interface ProfileRevisionRecord {
  readonly id: string;
  readonly candidateId: string;
  readonly commandId: string;
  readonly section: ProfileRevisionSection;
  readonly experienceId?: string | null;
  readonly previousText: string;
  readonly appliedText: string;
  readonly createdAt: string;
  readonly revertedAt?: string | null;
}

interface RevisionRow {
  id: string;
  candidate_id: string;
  command_id: string;
  section: 'headline' | 'about' | 'experience';
  experience_id: string | null;
  previous_text_cipher: string;
  applied_text_cipher: string;
  created_at: string;
  reverted_at: string | null;
}

export class SqliteProfileRevisionRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(MIGRATION_37);
  }

  recordRevision(input: {
    readonly id: string;
    readonly candidateId: string;
    readonly commandId: string;
    readonly section: ProfileRevisionSection;
    readonly experienceId?: string | null;
    readonly previousText: string;
    readonly appliedText: string;
    readonly createdAt: string;
  }): ProfileRevisionRecord {
    this.database
      .prepare(
        `INSERT INTO profile_revisions (id, candidate_id, command_id, section, experience_id, previous_text_cipher, applied_text_cipher, created_at, reverted_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      )
      .run(
        input.id,
        input.candidateId,
        input.commandId,
        input.section === 'skills' ? 'experience' : input.section,
        input.section === 'skills'
          ? `${SKILL_KEY_PREFIX}${input.experienceId ?? ''}`
          : (input.experienceId ?? null),
        this.seal(input.candidateId, input.id, 'previous', input.previousText),
        this.seal(input.candidateId, input.id, 'applied', input.appliedText),
        input.createdAt,
      );
    return {
      ...input,
      experienceId: input.experienceId ?? null,
      revertedAt: null,
    };
  }

  listRevisions(candidateId: string): ProfileRevisionRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, candidate_id, command_id, section, experience_id, previous_text_cipher, applied_text_cipher, created_at, reverted_at
         FROM profile_revisions
         WHERE candidate_id = ?
         ORDER BY created_at DESC`,
      )
      .all(candidateId) as unknown as RevisionRow[];
    return rows.map((row) => this.mapRow(row));
  }

  getRevisionByCommandId(candidateId: string, commandId: string): ProfileRevisionRecord | null {
    const row = this.database
      .prepare(
        `SELECT id, candidate_id, command_id, section, experience_id, previous_text_cipher, applied_text_cipher, created_at, reverted_at
         FROM profile_revisions
         WHERE candidate_id = ? AND command_id = ?`,
      )
      .get(candidateId, commandId) as unknown as RevisionRow | undefined;
    return row ? this.mapRow(row) : null;
  }

  markReverted(candidateId: string, commandId: string, revertedAt: string): void {
    this.database
      .prepare(
        `UPDATE profile_revisions
         SET reverted_at = ?
         WHERE candidate_id = ? AND command_id = ? AND reverted_at IS NULL`,
      )
      .run(revertedAt, candidateId, commandId);
  }

  private mapRow(row: RevisionRow): ProfileRevisionRecord {
    return {
      id: row.id,
      candidateId: row.candidate_id,
      commandId: row.command_id,
      section: isSkillRow(row) ? 'skills' : row.section,
      experienceId: isSkillRow(row)
        ? row.experience_id!.slice(SKILL_KEY_PREFIX.length)
        : row.experience_id,
      previousText: this.sealedText.open(
        row.previous_text_cipher,
        profileRevisionAssociatedData(row.candidate_id, row.id, 'previous'),
      ),
      appliedText: this.sealedText.open(
        row.applied_text_cipher,
        profileRevisionAssociatedData(row.candidate_id, row.id, 'applied'),
      ),
      createdAt: row.created_at,
      revertedAt: row.reverted_at,
    };
  }

  private seal(candidateId: string, id: string, field: 'previous' | 'applied', value: string) {
    return this.sealedText.seal(value, profileRevisionAssociatedData(candidateId, id, field));
  }
}

function profileRevisionAssociatedData(
  candidateId: string,
  revisionId: string,
  field: 'previous' | 'applied',
): string {
  return `candidate:${candidateId}:profile-revision:${revisionId}:${field}`;
}

function isSkillRow(row: RevisionRow): boolean {
  return row.section === 'experience' && Boolean(row.experience_id?.startsWith(SKILL_KEY_PREFIX));
}
