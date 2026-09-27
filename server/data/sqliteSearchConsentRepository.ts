import { DatabaseSync } from 'node:sqlite';
import type { SearchConsentState } from '../../shared/searchConsent';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';
import { MIGRATION_36 } from './searchConsentSchema';

export type SearchConsentRepoOptions = DatabaseSync | { databasePath: string };

interface ConsentRow {
  granted: number;
  policy_version: string;
  updated_at: string;
}

const NOT_GRANTED: SearchConsentState = {
  granted: false,
  policyVersion: '',
  updatedAt: '',
};

/**
 * Хранит одно решение кандидата на согласие «Вы в поиске» (B263). Без
 * согласия срезы 2/3 механики B (контакт нанимающего, «Как вас видят»)
 * недоступны — сервер, а не только UI, отклоняет запрос (критерий приёмки
 * среза 1 из спецификации B263).
 */
export class SqliteSearchConsentRepository {
  private readonly database: DatabaseSync;

  constructor(options: SearchConsentRepoOptions) {
    if (options instanceof DatabaseSync) {
      this.database = options;
    } else {
      this.database = new DatabaseSync(options.databasePath);
      this.database.exec('PRAGMA journal_mode = WAL;');
      applySqliteBusyTimeout(this.database);
    }
    this.database.exec(MIGRATION_36);
  }

  get(candidateId: string): SearchConsentState {
    const row = this.database
      .prepare(
        `SELECT granted, policy_version, updated_at FROM search_consents WHERE candidate_id = ?`,
      )
      .get(candidateId) as unknown as ConsentRow | undefined;
    if (!row) {
      return NOT_GRANTED;
    }
    return {
      granted: row.granted === 1,
      policyVersion: row.policy_version,
      updatedAt: row.updated_at,
    };
  }

  set(
    candidateId: string,
    input: { granted: boolean; policyVersion: string },
    now: string = new Date().toISOString(),
  ): SearchConsentState {
    this.database
      .prepare(
        `INSERT INTO search_consents (candidate_id, granted, policy_version, updated_at)
           VALUES (?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           granted = excluded.granted,
           policy_version = excluded.policy_version,
           updated_at = excluded.updated_at`,
      )
      .run(candidateId, input.granted ? 1 : 0, input.policyVersion, now);
    return { granted: input.granted, policyVersion: input.policyVersion, updatedAt: now };
  }

  close(): void {
    this.database.close();
  }
}
