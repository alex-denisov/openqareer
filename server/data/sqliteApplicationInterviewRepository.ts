import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';

export type InterviewPrepStatus = 'none' | 'ready';

export interface StoredApplicationInterview {
  readonly id: string;
  readonly applicationId: string;
  readonly round: number;
  readonly scheduledAt: string | null;
  readonly format: string | null;
  readonly prepStatus: InterviewPrepStatus;
  readonly prep: string | null;
  readonly debrief: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateInterviewInput {
  readonly round: number;
  readonly scheduledAt?: string | null;
  readonly format?: string | null;
}

export interface PatchInterviewInput {
  readonly scheduledAt?: string | null;
  readonly format?: string | null;
  readonly prepStatus?: InterviewPrepStatus;
  readonly prep?: string | null;
  readonly debrief?: string | null;
}

interface InterviewRow {
  id: string;
  application_id: string;
  round: number;
  scheduled_at: string | null;
  format: string | null;
  prep_status: InterviewPrepStatus;
  prep_cipher: string | null;
  debrief_cipher: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * `POST /applications/:id/interviews`, `PATCH .../interviews/:iid` (B251,
 * S2, architecture.md §3–4). Prep notes and debrief are sensitive free text,
 * sealed like the rest of the tracker's free-form fields.
 */
export class SqliteApplicationInterviewRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  create(
    applicationId: string,
    input: CreateInterviewInput,
    now = new Date().toISOString(),
  ): StoredApplicationInterview {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO application_interviews
          (id, application_id, round, scheduled_at, format, prep_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'none', ?, ?)`,
      )
      .run(id, applicationId, input.round, input.scheduledAt ?? null, input.format ?? null, now, now);
    return this.get(applicationId, id) as StoredApplicationInterview;
  }

  patch(
    applicationId: string,
    id: string,
    input: PatchInterviewInput,
    now = new Date().toISOString(),
  ): StoredApplicationInterview | null {
    const current = this.get(applicationId, id);
    if (!current) return null;
    this.database
      .prepare(
        `UPDATE application_interviews SET
           scheduled_at = ?, format = ?, prep_status = ?, prep_cipher = ?, debrief_cipher = ?, updated_at = ?
         WHERE application_id = ? AND id = ?`,
      )
      .run(
        input.scheduledAt !== undefined ? input.scheduledAt : current.scheduledAt,
        input.format !== undefined ? input.format : current.format,
        input.prepStatus ?? current.prepStatus,
        this.sealValue(applicationId, id, 'prep', input.prep !== undefined ? input.prep : current.prep),
        this.sealValue(
          applicationId,
          id,
          'debrief',
          input.debrief !== undefined ? input.debrief : current.debrief,
        ),
        now,
        applicationId,
        id,
      );
    return this.get(applicationId, id);
  }

  list(applicationId: string): StoredApplicationInterview[] {
    const rows = this.database
      .prepare(`${INTERVIEW_SELECT} WHERE application_id = ? ORDER BY scheduled_at`)
      .all(applicationId) as unknown as InterviewRow[];
    return rows.map((row) => this.toInterview(row));
  }

  get(applicationId: string, id: string): StoredApplicationInterview | null {
    const row = this.database
      .prepare(`${INTERVIEW_SELECT} WHERE application_id = ? AND id = ?`)
      .get(applicationId, id) as InterviewRow | undefined;
    return row ? this.toInterview(row) : null;
  }

  private sealValue(
    applicationId: string,
    interviewId: string,
    field: 'prep' | 'debrief',
    value: string | null,
  ): string | null {
    return value === null ? null : this.sealedText.seal(value, associatedData(applicationId, interviewId, field));
  }

  private toInterview(row: InterviewRow): StoredApplicationInterview {
    return {
      id: row.id,
      applicationId: row.application_id,
      round: row.round,
      scheduledAt: row.scheduled_at,
      format: row.format,
      prepStatus: row.prep_status,
      prep: row.prep_cipher ? this.sealedText.open(row.prep_cipher, associatedData(row.application_id, row.id, 'prep')) : null,
      debrief: row.debrief_cipher
        ? this.sealedText.open(row.debrief_cipher, associatedData(row.application_id, row.id, 'debrief'))
        : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

const INTERVIEW_SELECT = `
  SELECT id, application_id, round, scheduled_at, format, prep_status, prep_cipher, debrief_cipher, created_at, updated_at
  FROM application_interviews
`;

function associatedData(applicationId: string, interviewId: string, field: 'prep' | 'debrief'): string {
  return `application:${applicationId}:interview:${interviewId}:${field}`;
}
