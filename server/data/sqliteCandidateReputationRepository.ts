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
  overall_status TEXT NOT NULL CHECK (overall_status IN ('safe', 'attention', 'critical_risk')),
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
    this.database.exec(CANDIDATE_REPUTATION_AUDITS_SCHEMA);
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

  getLatestAudit(candidateId: string): CandidateReputationAudit | null {
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
    return row ? toAudit(row) : null;
  }

  close(): void {
    this.database.close();
  }
}
