import { DatabaseSync } from 'node:sqlite';
import type { ManualApplyReason } from '../../shared/manualApply';
import { SealedText } from '../data/sealedText';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/** B787: очередь откликов, которые кандидат отправляет сам. Содержимое запечатано. */
export const MANUAL_APPLY_SCHEMA = `
CREATE TABLE IF NOT EXISTS manual_apply_queue (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  vacancy_id TEXT NOT NULL,
  application_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'sent', 'skipped')),
  prepared INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  payload_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, vacancy_id)
) STRICT;
`;

export type ManualApplyStatus = 'open' | 'sent' | 'skipped';

export interface ManualApplyPayload {
  readonly title: string;
  readonly company: string;
  readonly url: string;
  readonly source: string;
  readonly reason: ManualApplyReason;
  readonly host: string;
  readonly letter: string | null;
  /** Ответ маршрута письма целиком: экран письма показывает то же письмо без нового вызова. */
  readonly pitch: unknown;
}

export interface StoredManualApply extends ManualApplyPayload {
  readonly vacancyId: string;
  readonly applicationId: string;
  readonly status: ManualApplyStatus;
  readonly prepared: boolean;
  readonly attempts: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

interface Row {
  vacancy_id: string;
  application_id: string;
  status: ManualApplyStatus;
  prepared: number;
  attempts: number;
  payload_cipher: string;
  created_at: string;
  updated_at: string;
}

type Enqueue = Omit<ManualApplyPayload, 'letter' | 'pitch'> & {
  readonly applicationId: string;
  readonly at: string;
};

export class SqliteManualApplyRepository {
  private readonly sealedText: SealedText;

  constructor(
    private readonly database: DatabaseSync,
    encryptionKey: Buffer,
  ) {
    this.sealedText = new SealedText(encryptionKey);
    applySqliteBusyTimeout(database);
    database.exec(MANUAL_APPLY_SCHEMA);
  }

  private scope(candidateId: string, vacancyId: string): string {
    return `manual-apply:${candidateId}:${vacancyId}`;
  }

  private seal(candidateId: string, vacancyId: string, payload: ManualApplyPayload): string {
    return this.sealedText.seal(JSON.stringify(payload), this.scope(candidateId, vacancyId));
  }

  /** Повреждённая строка не роняет список. */
  private toStored(candidateId: string, row: Row): StoredManualApply[] {
    try {
      const payload = JSON.parse(
        this.sealedText.open(row.payload_cipher, this.scope(candidateId, row.vacancy_id)),
      ) as ManualApplyPayload;
      return [
        {
          ...payload,
          vacancyId: row.vacancy_id,
          applicationId: row.application_id,
          status: row.status,
          prepared: row.prepared === 1,
          attempts: row.attempts,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      ];
    } catch {
      return [];
    }
  }

  get(candidateId: string, vacancyId: string): StoredManualApply | null {
    const row = this.database
      .prepare('SELECT * FROM manual_apply_queue WHERE candidate_id = ? AND vacancy_id = ?')
      .get(candidateId, vacancyId) as unknown as Row | undefined;
    return row ? (this.toStored(candidateId, row)[0] ?? null) : null;
  }

  listOpen(candidateId: string): StoredManualApply[] {
    return this.exportAll(candidateId).filter((item) => item.status === 'open');
  }

  /** Вся очередь кандидата — для выгрузки данных. */
  exportAll(candidateId: string): StoredManualApply[] {
    const rows = this.database
      .prepare('SELECT * FROM manual_apply_queue WHERE candidate_id = ? ORDER BY created_at DESC, vacancy_id')
      .all(candidateId) as unknown as Row[];
    return rows.flatMap((row) => this.toStored(candidateId, row));
  }

  /** Повторная постановка не теряет собранное письмо; возвращённый отклик снова открыт. */
  enqueue(candidateId: string, vacancyId: string, input: Enqueue): StoredManualApply {
    const { applicationId, at, ...facts } = input;
    const known = this.get(candidateId, vacancyId);
    const payload = { ...facts, letter: known?.letter ?? null, pitch: known?.pitch ?? null };
    this.database
      .prepare(
        `INSERT INTO manual_apply_queue
           (candidate_id, vacancy_id, application_id, status, payload_cipher, created_at, updated_at)
         VALUES (?, ?, ?, 'open', ?, ?, ?)
         ON CONFLICT(candidate_id, vacancy_id) DO UPDATE SET
           application_id = excluded.application_id, status = 'open',
           payload_cipher = excluded.payload_cipher, updated_at = excluded.updated_at`,
      )
      .run(candidateId, vacancyId, applicationId, this.seal(candidateId, vacancyId, payload), at, at);
    return this.get(candidateId, vacancyId)!;
  }

  startAttempt(candidateId: string, vacancyId: string): void {
    this.database
      .prepare('UPDATE manual_apply_queue SET attempts = attempts + 1 WHERE candidate_id = ? AND vacancy_id = ?')
      .run(candidateId, vacancyId);
  }

  saveLetter(candidateId: string, vacancyId: string, letter: string, pitch: unknown): void {
    const known = this.get(candidateId, vacancyId);
    if (!known) return;
    const { title, company, url, source, reason, host } = known;
    const payload = { title, company, url, source, reason, host, letter, pitch };
    this.database
      .prepare('UPDATE manual_apply_queue SET payload_cipher = ? WHERE candidate_id = ? AND vacancy_id = ?')
      .run(this.seal(candidateId, vacancyId, payload), candidateId, vacancyId);
  }

  markPrepared(candidateId: string, vacancyId: string): void {
    this.database
      .prepare('UPDATE manual_apply_queue SET prepared = 1 WHERE candidate_id = ? AND vacancy_id = ?')
      .run(candidateId, vacancyId);
  }

  close(candidateId: string, vacancyId: string, status: 'sent' | 'skipped', at: string): void {
    this.database
      .prepare(
        'UPDATE manual_apply_queue SET status = ?, updated_at = ? WHERE candidate_id = ? AND vacancy_id = ?',
      )
      .run(status, at, candidateId, vacancyId);
  }
}
