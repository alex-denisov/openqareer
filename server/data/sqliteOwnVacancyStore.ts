import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { OwnVacancyWorkFormat } from '../../shared/b640OwnVacancy';
import { SealedText } from './sealedText';

/**
 * B676: вакансии, которые кандидат принёс сам. Видны только ему: строка находится
 * по токену кандидата, всё содержимое (название, компания, адрес, текст) запечатано.
 * Таблица новая; прежние таблицы не меняются.
 */
export interface OwnVacancyRecord {
  readonly id: string;
  readonly createdAt: string;
  readonly title: string;
  readonly company: string | null;
  readonly location: string | null;
  readonly workFormat: OwnVacancyWorkFormat | null;
  readonly url: string | null;
  readonly text: string;
}
export type NewOwnVacancy = Omit<OwnVacancyRecord, 'id' | 'createdAt'>;

interface Row { readonly id: string; readonly created_at: string; readonly payload_cipher: string }

export class SqliteOwnVacancyStore {
  private readonly sealed: SealedText;
  constructor(private readonly db: DatabaseSync, encryptionKey: Buffer) {
    this.sealed = new SealedText(encryptionKey);
    db.exec(`CREATE TABLE IF NOT EXISTS b640_own_vacancies (
      id TEXT PRIMARY KEY, candidate_key TEXT NOT NULL, created_at TEXT NOT NULL, payload_cipher TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS b640_own_vacancies_candidate ON b640_own_vacancies(candidate_key, created_at DESC)`);
  }

  private candidateKey(candidateId: string): string {
    return this.sealed.indexToken('b640-own-vacancy-candidate', candidateId);
  }

  private open(row: Row): OwnVacancyRecord {
    const payload = JSON.parse(this.sealed.open(row.payload_cipher, row.id)) as NewOwnVacancy;
    return { ...payload, id: row.id, createdAt: row.created_at };
  }

  count(candidateId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM b640_own_vacancies WHERE candidate_key=?').get(this.candidateKey(candidateId)) as { n: number };
    return Number(row.n);
  }

  create(candidateId: string, vacancy: NewOwnVacancy, now = new Date()): OwnVacancyRecord {
    const id = `own-${randomUUID()}`;
    const createdAt = now.toISOString();
    this.db.prepare('INSERT INTO b640_own_vacancies (id,candidate_key,created_at,payload_cipher) VALUES (?,?,?,?)')
      .run(id, this.candidateKey(candidateId), createdAt, this.sealed.seal(JSON.stringify(vacancy), id));
    return { ...vacancy, id, createdAt };
  }

  list(candidateId: string): readonly OwnVacancyRecord[] {
    const rows = this.db.prepare('SELECT id,created_at,payload_cipher FROM b640_own_vacancies WHERE candidate_key=? ORDER BY created_at DESC, rowid DESC')
      .all(this.candidateKey(candidateId)) as unknown as Row[];
    return rows.map((row) => this.open(row));
  }

  get(candidateId: string, id: string): OwnVacancyRecord | undefined {
    const row = this.db.prepare('SELECT id,created_at,payload_cipher FROM b640_own_vacancies WHERE id=? AND candidate_key=?')
      .get(id, this.candidateKey(candidateId)) as Row | undefined;
    return row ? this.open(row) : undefined;
  }

  delete(candidateId: string, id: string): boolean {
    const result = this.db.prepare('DELETE FROM b640_own_vacancies WHERE id=? AND candidate_key=?').run(id, this.candidateKey(candidateId));
    return Number(result.changes) > 0;
  }

  deleteCandidate(candidateId: string): number {
    return Number(this.db.prepare('DELETE FROM b640_own_vacancies WHERE candidate_key=?').run(this.candidateKey(candidateId)).changes);
  }
}
