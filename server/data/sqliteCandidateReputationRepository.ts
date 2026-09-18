import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type {
  CandidateReputationAudit,
  ConsistencyDiscrepancy,
  ReputationAuditStatus,
  ReputationOverallStatus,
  ReputationRiskItem,
} from '../../shared/candidateReputation';

export const CANDIDATE_REPUTATION_AUDITS_SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_reputation_audits (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  overall_status TEXT NOT NULL CHECK (overall_status IN ('safe', 'attention', 'critical_risk', 'not_scanned')),
  score INTEGER NOT NULL,
  consistency_findings_json TEXT NOT NULL,
  reputation_findings_json TEXT NOT NULL,
  consent_action TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
) STRICT;
CREATE INDEX IF NOT EXISTS idx_candidate_reputation_audits_candidate
  ON candidate_reputation_audits(candidate_id, started_at);
`;

const CANDIDATE_REPUTATION_AUDITS_SCHEMA_WITH_FK = CANDIDATE_REPUTATION_AUDITS_SCHEMA.replace(
  '  completed_at TEXT\n) STRICT;',
  '  completed_at TEXT,\n  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE\n) STRICT;',
);

interface CandidateReputationAuditRow {
  id: string;
  candidate_id: string;
  status: ReputationAuditStatus;
  overall_status: ReputationOverallStatus;
  score: number;
  consistency_findings_json: string;
  reputation_findings_json: string;
  consent_action: string;
  started_at: string;
  completed_at: string | null;
}

export type CandidateReputationRepoOptions =
  | DatabaseSync
  | { databasePath: string };

function parseJsonArray<T>(raw: string): T[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function toAudit(row: CandidateReputationAuditRow): CandidateReputationAudit {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    status: row.status,
    overallStatus: row.overall_status,
    score: Number(row.score),
    consistencyDiscrepancies: parseJsonArray<ConsistencyDiscrepancy>(
      row.consistency_findings_json,
    ),
    reputationRisks: parseJsonArray<ReputationRiskItem>(
      row.reputation_findings_json,
    ),
    consentAction: row.consent_action,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? undefined,
  };
}

function sanitizeUntrustedSafeScore(audit: CandidateReputationAudit): CandidateReputationAudit {
  if (audit.overallStatus !== 'safe' || audit.score !== 100) return audit;
  return {
    ...audit,
    overallStatus: 'not_scanned',
    score: 0,
    consentAction: 'Источники цифрового следа не подключены: результат не является оценкой безопасности.',
  };
}

function auditToParams(audit: CandidateReputationAudit): SQLInputValue[] {
  return [
    audit.id,
    audit.candidateId,
    audit.status,
    audit.overallStatus,
    audit.score,
    JSON.stringify(audit.consistencyDiscrepancies),
    JSON.stringify(audit.reputationRisks),
    audit.consentAction,
    audit.startedAt,
    audit.completedAt ?? null,
  ];
}

export class SqliteCandidateReputationRepository {
  private readonly database: DatabaseSync;

  constructor(options: CandidateReputationRepoOptions) {
    if (options instanceof DatabaseSync) {
      this.database = options;
    } else {
      if (options.databasePath !== ':memory:') {
        mkdirSync(dirname(options.databasePath), { recursive: true });
      }
      this.database = new DatabaseSync(options.databasePath);
      this.database.exec('PRAGMA journal_mode = WAL;');
      this.database.exec('PRAGMA foreign_keys = ON;');
    }
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec(CANDIDATE_REPUTATION_AUDITS_SCHEMA);
    const tableSql = this.database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'candidate_reputation_audits'")
      .get() as { sql?: string } | undefined;
    if (tableSql?.sql && !tableSql.sql.includes('not_scanned')) {
      this.database.exec('DROP INDEX IF EXISTS idx_candidate_reputation_audits_candidate');
      this.database.exec('ALTER TABLE candidate_reputation_audits RENAME TO candidate_reputation_audits_legacy');
      this.database.exec(CANDIDATE_REPUTATION_AUDITS_SCHEMA);
      this.database.exec(`
        INSERT INTO candidate_reputation_audits
          (id, candidate_id, status, overall_status, score,
           consistency_findings_json, reputation_findings_json, consent_action,
           started_at, completed_at)
        SELECT id, candidate_id, status,
          CASE WHEN overall_status IN ('safe', 'attention', 'critical_risk')
            THEN overall_status ELSE 'not_scanned' END,
          score, consistency_findings_json, reputation_findings_json,
          consent_action, started_at, completed_at
        FROM candidate_reputation_audits_legacy
      `);
      this.database.exec('DROP TABLE candidate_reputation_audits_legacy');
    }
    const columns = this.database
      .prepare('PRAGMA table_info(candidate_reputation_audits)')
      .all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'candidate_id')) {
      this.database.exec(
        "ALTER TABLE candidate_reputation_audits ADD COLUMN candidate_id TEXT NOT NULL DEFAULT ''",
      );
    }
    this.ensureCandidateForeignKey();
  }

  private ensureCandidateForeignKey(): void {
    const hasCandidates = this.database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidates'")
      .get() !== undefined;
    if (!hasCandidates) return;
    const tableSql = this.database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'candidate_reputation_audits'")
      .get() as { sql?: string } | undefined;
    if (tableSql?.sql?.includes('REFERENCES candidates')) return;

    this.database.exec('DROP INDEX IF EXISTS idx_candidate_reputation_audits_candidate');
    this.database.exec('ALTER TABLE candidate_reputation_audits RENAME TO candidate_reputation_audits_legacy_fk');
    this.database.exec(CANDIDATE_REPUTATION_AUDITS_SCHEMA_WITH_FK);
    this.database.exec(`
      INSERT INTO candidate_reputation_audits (
        id, candidate_id, status, overall_status, score,
        consistency_findings_json, reputation_findings_json,
        consent_action, started_at, completed_at
      )
      SELECT old.id, old.candidate_id, old.status, old.overall_status, old.score,
        old.consistency_findings_json, old.reputation_findings_json,
        old.consent_action, old.started_at, old.completed_at
      FROM candidate_reputation_audits_legacy_fk old
      WHERE EXISTS (SELECT 1 FROM candidates c WHERE c.id = old.candidate_id)
    `);
    this.database.exec('DROP TABLE candidate_reputation_audits_legacy_fk');
  }

  saveAudit(audit: CandidateReputationAudit): void {
    const stmt = this.database.prepare(`
      INSERT OR REPLACE INTO candidate_reputation_audits (
        id, candidate_id, status, overall_status, score,
        consistency_findings_json, reputation_findings_json,
        consent_action, started_at, completed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(...auditToParams(audit));
  }

  getLatestAudit(candidateId: string, options?: { trustedOnly?: boolean }): CandidateReputationAudit | null {
    const stmt = this.database.prepare(`
      SELECT
        id, candidate_id, status, overall_status, score,
        consistency_findings_json, reputation_findings_json,
        consent_action, started_at, completed_at
      FROM candidate_reputation_audits
      WHERE candidate_id = ?
      ORDER BY started_at DESC
      LIMIT 1
    `);
    const row = stmt.get(candidateId) as unknown as CandidateReputationAuditRow | undefined;
    if (!row) return null;
    const audit = toAudit(row);
    return options?.trustedOnly ? sanitizeUntrustedSafeScore(audit) : audit;
  }

  deleteAuditsByCandidateId(candidateId: string): number {
    return Number(
      this.database
        .prepare('DELETE FROM candidate_reputation_audits WHERE candidate_id = ?')
        .run(candidateId).changes,
    );
  }

  listAudits(candidateId: string, options?: { trustedOnly?: boolean }): CandidateReputationAudit[] {
    const rows = this.database
      .prepare(`
        SELECT id, candidate_id, status, overall_status, score,
          consistency_findings_json, reputation_findings_json,
          consent_action, started_at, completed_at
        FROM candidate_reputation_audits
        WHERE candidate_id = ?
        ORDER BY started_at DESC, id DESC
      `)
      .all(candidateId) as unknown as CandidateReputationAuditRow[];
    return rows.map(toAudit).map((audit) =>
      options?.trustedOnly ? sanitizeUntrustedSafeScore(audit) : audit,
    );
  }

  close(): void {
    this.database.close();
  }
}
