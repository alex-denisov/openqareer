import type { DatabaseSync } from 'node:sqlite';
import type { ReferralTrack } from '../../shared/referralTrack';
import { MIGRATION_40 } from './referralTrackSchema';
import type { SealedText } from './sealedText';

/** Минимум о стороннем человеке: имя, роль, ссылка на профиль. */
export interface ReferralContactRecord {
  readonly name: string;
  readonly role: string | null;
  readonly profileUrl: string | null;
}

export interface StoredReferralTrack {
  readonly applicationId: string;
  readonly contact: ReferralContactRecord;
  readonly track: ReferralTrack;
  readonly version: number;
  readonly updatedAt: string;
}

interface ReferralRow {
  body_cipher: string;
  version: number;
  updated_at: string;
}

interface ReferralBody {
  readonly contact: ReferralContactRecord;
  readonly track: ReferralTrack;
}

/** Трек рекомендации на отклик (B389). Контакт третьего лица хранится запечатанным. */
export class SqliteReferralTrackRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(MIGRATION_40);
  }

  get(candidateId: string, applicationId: string): StoredReferralTrack | null {
    const row = this.database
      .prepare(
        `SELECT body_cipher, version, updated_at
         FROM application_referral_track WHERE candidate_id = ? AND application_id = ?`,
      )
      .get(candidateId, applicationId) as unknown as ReferralRow | undefined;
    if (!row) return null;
    const body = JSON.parse(
      this.sealedText.open(row.body_cipher, associatedData(candidateId, applicationId)),
    ) as ReferralBody;
    return {
      applicationId,
      contact: body.contact,
      track: body.track,
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  put(
    candidateId: string,
    applicationId: string,
    contact: ReferralContactRecord,
    track: ReferralTrack,
    now: string,
  ): StoredReferralTrack {
    const cipher = this.sealedText.seal(
      JSON.stringify({ contact, track } satisfies ReferralBody),
      associatedData(candidateId, applicationId),
    );
    this.database
      .prepare(
        `INSERT INTO application_referral_track (application_id, candidate_id, body_cipher, version, updated_at)
         VALUES (?, ?, ?, 1, ?)
         ON CONFLICT(application_id) DO UPDATE SET
           body_cipher = excluded.body_cipher,
           version = application_referral_track.version + 1,
           updated_at = excluded.updated_at
         WHERE application_referral_track.candidate_id = excluded.candidate_id`,
      )
      .run(applicationId, candidateId, cipher, now);
    const stored = this.get(candidateId, applicationId);
    if (!stored) throw new Error('referral track was not stored');
    return stored;
  }
}

function associatedData(candidateId: string, applicationId: string): string {
  return `candidate:${candidateId}:application:${applicationId}:referral-track`;
}
