import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { SavedRelocationScenario } from '../../shared/relocationScenario';
import type { SealedText } from './sealedText';

interface Row { id: string; payload: string; request_hash: string; }
export class RelocationScenarioConflict extends Error {}
export class RelocationScenarioLimit extends Error {}
export class SqliteRelocationScenarioRepository {
  constructor(private readonly database: DatabaseSync, private readonly sealed: SealedText) {
    database.exec(`CREATE TABLE IF NOT EXISTS relocation_scenarios (
      id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      retry_key TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL,
      UNIQUE(candidate_id, retry_key)) STRICT;
      CREATE INDEX IF NOT EXISTS relocation_scenarios_candidate ON relocation_scenarios(candidate_id, created_at DESC, id);`);
  }
  requestHash(candidateId: string, value: string) { return this.sealed.indexToken(`relocation-scenario-body:${candidateId}`, value); }
  save(candidateId: string, key: string, requestHash: string, value: Omit<SavedRelocationScenario, 'id'>) {
    const retryKey = this.sealed.indexToken(`relocation-scenario:${candidateId}`, key);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const existing = this.database.prepare('SELECT id, payload, request_hash FROM relocation_scenarios WHERE candidate_id = ? AND retry_key = ?').get(candidateId, retryKey) as Row | undefined;
      if (existing) {
        if (existing.request_hash !== requestHash) throw new RelocationScenarioConflict();
        const saved = this.open(candidateId, existing);
        this.database.exec('COMMIT');
        return { value: saved, created: false };
      }
      const count = this.database.prepare('SELECT COUNT(*) AS n FROM relocation_scenarios WHERE candidate_id = ?').get(candidateId) as { n: number };
      if (count.n >= 50) throw new RelocationScenarioLimit();
      const id = randomUUID(); const saved: SavedRelocationScenario = { ...value, id };
      this.database.prepare('INSERT INTO relocation_scenarios VALUES (?, ?, ?, ?, ?, ?)').run(id, candidateId, retryKey, requestHash, value.createdAt, this.sealed.seal(JSON.stringify(saved), this.aad(candidateId, id)));
      this.database.exec('COMMIT');
      return { value: saved, created: true };
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  list(candidateId: string, limit = 20, offset = 0) {
    const boundedLimit = Math.min(50, Math.max(1, limit));
    const rows = this.database.prepare('SELECT id, payload, request_hash FROM relocation_scenarios WHERE candidate_id = ? ORDER BY created_at DESC, id LIMIT ? OFFSET ?').all(candidateId, boundedLimit + 1, Math.max(0, offset)) as unknown as Row[];
    return { items: rows.slice(0, boundedLimit).map((row) => this.open(candidateId, row)), nextOffset: rows.length > boundedLimit ? offset + boundedLimit : null };
  }
  get(candidateId: string, id: string) {
    const row = this.database.prepare('SELECT id, payload, request_hash FROM relocation_scenarios WHERE candidate_id = ? AND id = ?').get(candidateId, id) as Row | undefined;
    return row ? this.open(candidateId, row) : null;
  }
  delete(candidateId: string, id: string) {
    return this.database.prepare('DELETE FROM relocation_scenarios WHERE candidate_id = ? AND id = ?').run(candidateId, id).changes > 0;
  }
  deleteAll(candidateId: string) { this.database.prepare('DELETE FROM relocation_scenarios WHERE candidate_id = ?').run(candidateId); }
  private aad(candidateId: string, id: string) { return `relocation-scenario:v1:${candidateId}:${id}`; }
  private open(candidateId: string, row: Row): SavedRelocationScenario { return JSON.parse(this.sealed.open(row.payload, this.aad(candidateId, row.id))) as SavedRelocationScenario; }
}
