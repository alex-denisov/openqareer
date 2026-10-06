import type { DatabaseSync } from 'node:sqlite';
import type { CandidateDecisionProfile } from '../../shared/workPreferences';
import { MIGRATION_43 } from './decisionProfileSchema';
import type { SealedText } from './sealedText';

/** Профиль ограничений кандидата (B384). Хранится запечатанным, один на кандидата. */
export class SqliteDecisionProfileRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(MIGRATION_43);
  }

  get(candidateId: string): CandidateDecisionProfile | null {
    const row = this.database
      .prepare('SELECT profile_cipher FROM candidate_decision_profile WHERE candidate_id = ?')
      .get(candidateId) as unknown as { profile_cipher: string } | undefined;
    if (!row) return null;
    return JSON.parse(
      this.sealedText.open(row.profile_cipher, associatedData(candidateId)),
    ) as CandidateDecisionProfile;
  }

  put(candidateId: string, profile: CandidateDecisionProfile, now: string): CandidateDecisionProfile {
    const stored = { ...profile, updatedAt: now };
    this.database
      .prepare(
        `INSERT INTO candidate_decision_profile (candidate_id, profile_cipher, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           profile_cipher = excluded.profile_cipher,
           updated_at = excluded.updated_at`,
      )
      .run(candidateId, this.sealedText.seal(JSON.stringify(stored), associatedData(candidateId)), now);
    return stored;
  }
}

function associatedData(candidateId: string): string {
  return `candidate:${candidateId}:decision-profile`;
}
