import type { DatabaseSync } from 'node:sqlite';
import type { AdaptationTaskSuggestion } from '../../shared/adaptationCoach';
import type { SealedText } from './sealedText';
import { MIGRATION_44 } from './careerDiarySchema';
import { openPayload, sealPayload } from './careerDiaryRepositoryHelpers';

export interface AdaptationApplication {
  turnKey: string; workplaceId: string; planId: string; taskId: string; targetTaskId: string | null;
  edits: Pick<AdaptationTaskSuggestion, 'title' | 'description'> & { dueDate: string };
  appliedAt: string;
}
export const MIGRATION_ADAPTATION_APPLICATIONS = MIGRATION_44 + `
CREATE TABLE IF NOT EXISTS career_diary_adaptation_applications (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  turn_key TEXT NOT NULL,
  workplace_id TEXT NOT NULL,
  payload_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(candidate_id, turn_key),
  FOREIGN KEY(candidate_id, workplace_id) REFERENCES career_diary_workplaces(candidate_id, id) ON DELETE CASCADE
) STRICT;
`;

export class AdaptationApplications {
  constructor(private readonly database: DatabaseSync, private readonly sealedText: SealedText) {
    database.exec(MIGRATION_ADAPTATION_APPLICATIONS);
  }
  get(candidateId: string, key: string): AdaptationApplication | null {
    const row = this.database.prepare('SELECT payload_cipher FROM career_diary_adaptation_applications WHERE candidate_id=? AND turn_key=?').get(candidateId, key) as { payload_cipher: string } | undefined;
    return row ? openPayload(this.sealedText, candidateId, 'adaptation-application', key, row.payload_cipher) : null;
  }
  save(candidateId: string, receipt: AdaptationApplication): void {
    this.database.prepare('INSERT INTO career_diary_adaptation_applications(candidate_id,turn_key,workplace_id,payload_cipher,created_at) VALUES(?,?,?,?,?)').run(candidateId, receipt.turnKey, receipt.workplaceId, sealPayload(this.sealedText, candidateId, 'adaptation-application', receipt.turnKey, receipt), receipt.appliedAt);
  }
  exportApplications(candidateId: string): AdaptationApplication[] {
    const rows = this.database.prepare('SELECT turn_key,payload_cipher FROM career_diary_adaptation_applications WHERE candidate_id=? ORDER BY created_at,turn_key').all(candidateId) as Array<{ turn_key: string; payload_cipher: string }>;
    return rows.map(row => openPayload(this.sealedText, candidateId, 'adaptation-application', row.turn_key, row.payload_cipher));
  }
}
