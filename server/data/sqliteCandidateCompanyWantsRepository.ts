import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { SealedText } from './sealedText';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';

export interface CandidateCompanyWant {
  readonly companyKey: string;
  readonly companyName: string;
  readonly nextStep: string | null;
  readonly nextStepDueAt: string | null;
  readonly updatedAt: string;
}

interface WantRow {
  company_key: string;
  company_name: string;
  next_step_cipher: string | null;
  next_step_due_at: string | null;
  updated_at: string;
}

type RepositoryOptions = DatabaseSync | { databasePath: string; encryptionKey: Buffer };

export class SqliteCandidateCompanyWantsRepository {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;
  private readonly ownsDatabase: boolean;

  constructor(options: RepositoryOptions, encryptionKey?: Buffer) {
    if (options instanceof DatabaseSync) {
      if (!encryptionKey) throw new Error('company wants encryption key is required');
      this.database = options;
      this.sealedText = new SealedText(encryptionKey);
      this.ownsDatabase = false;
    } else {
      if (options.databasePath !== ':memory:') {
        mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
      }
      this.database = new DatabaseSync(options.databasePath);
      this.sealedText = new SealedText(options.encryptionKey);
      this.ownsDatabase = true;
      this.database.exec('PRAGMA journal_mode = WAL;');
      applySqliteBusyTimeout(this.database);
    }
    this.database.exec('PRAGMA foreign_keys = ON;');
    const hasCandidates = this.database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidates'")
      .get() !== undefined;
    const candidateReference = hasCandidates ? 'REFERENCES candidates(id) ON DELETE CASCADE' : '';
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS candidate_company_wants (
        candidate_id TEXT NOT NULL ${candidateReference},
        company_key TEXT NOT NULL,
        company_name TEXT NOT NULL,
        next_step_cipher TEXT,
        next_step_due_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (candidate_id, company_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_candidate_company_wants_candidate
        ON candidate_company_wants(candidate_id, company_name);
    `);
  }

  list(candidateId: string): CandidateCompanyWant[] {
    const rows = this.database.prepare(`
      SELECT company_key, company_name, next_step_cipher, next_step_due_at, updated_at
      FROM candidate_company_wants WHERE candidate_id = ? ORDER BY company_name COLLATE NOCASE
    `).all(candidateId) as unknown as WantRow[];
    return rows.map((row) => this.toWant(candidateId, row));
  }

  get(candidateId: string, companyKey: string): CandidateCompanyWant | null {
    const row = this.database.prepare(`
      SELECT company_key, company_name, next_step_cipher, next_step_due_at, updated_at
      FROM candidate_company_wants WHERE candidate_id = ? AND company_key = ?
    `).get(candidateId, companyKey) as WantRow | undefined;
    return row ? this.toWant(candidateId, row) : null;
  }

  setWanted(
    candidateId: string,
    companyKey: string,
    companyName: string,
    now = new Date().toISOString(),
  ): CandidateCompanyWant {
    this.database.prepare(`
      INSERT INTO candidate_company_wants
        (candidate_id, company_key, company_name, next_step_cipher, next_step_due_at, created_at, updated_at)
      VALUES (?, ?, ?, NULL, NULL, ?, ?)
      ON CONFLICT(candidate_id, company_key) DO UPDATE SET
        company_name = excluded.company_name, updated_at = excluded.updated_at
    `).run(candidateId, companyKey, companyName, now, now);
    return this.get(candidateId, companyKey)!;
  }

  setNextStep(
    candidateId: string,
    companyKey: string,
    nextStep: string | null,
    dueAt: string | null,
    now = new Date().toISOString(),
  ): CandidateCompanyWant | null {
    const sealed = nextStep?.trim()
      ? this.sealedText.seal(nextStep.trim(), this.associatedData(candidateId, companyKey))
      : null;
    const result = this.database.prepare(`
      UPDATE candidate_company_wants
      SET next_step_cipher = ?, next_step_due_at = ?, updated_at = ?
      WHERE candidate_id = ? AND company_key = ?
    `).run(sealed, sealed ? dueAt : null, now, candidateId, companyKey);
    return Number(result.changes) === 1 ? this.get(candidateId, companyKey) : null;
  }

  remove(candidateId: string, companyKey: string): boolean {
    const result = this.database.prepare(
      'DELETE FROM candidate_company_wants WHERE candidate_id = ? AND company_key = ?',
    ).run(candidateId, companyKey);
    return Number(result.changes) === 1;
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  private toWant(candidateId: string, row: WantRow): CandidateCompanyWant {
    return {
      companyKey: row.company_key,
      companyName: row.company_name,
      nextStep: row.next_step_cipher
        ? this.sealedText.open(row.next_step_cipher, this.associatedData(candidateId, row.company_key))
        : null,
      nextStepDueAt: row.next_step_cipher ? row.next_step_due_at : null,
      updatedAt: row.updated_at,
    };
  }

  private associatedData(candidateId: string, companyKey: string): string {
    return `candidate-company-want:v1:${candidateId}:${companyKey}`;
  }
}
