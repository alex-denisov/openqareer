import type { DatabaseSync } from 'node:sqlite';
import {
  parseRoleSkillAssessmentRun,
  type RoleSkillAssessmentRun,
} from '../domain/roleSkillAssessment';
import type { SealedText } from './sealedText';

interface AssessmentRunRow {
  run_id: string;
  revision: number;
  run_cipher: string;
  created_at: string;
  updated_at: string;
}

export interface RoleSkillAssessmentRepository {
  create(candidateId: string, run: RoleSkillAssessmentRun): void;
  get(candidateId: string, runId: string): RoleSkillAssessmentRun | null;
  list(candidateId: string): RoleSkillAssessmentRun[];
  update(
    candidateId: string,
    run: RoleSkillAssessmentRun,
    expectedRevision: number,
  ): boolean;
}

export class SqliteRoleSkillAssessmentRepository implements RoleSkillAssessmentRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  create(candidateId: string, input: RoleSkillAssessmentRun): void {
    const run = parseRoleSkillAssessmentRun(input);
    if (run.revision !== 1) throw new Error('assessment_run_revision_invalid');
    this.database
      .prepare(
        `INSERT INTO role_skill_assessment_runs
          (candidate_id, run_id, revision, run_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        candidateId,
        run.id,
        run.revision,
        this.seal(candidateId, run.id, run),
        run.startedAt,
        run.updatedAt,
      );
  }

  get(candidateId: string, runId: string): RoleSkillAssessmentRun | null {
    const row = this.database
      .prepare(
        `SELECT run_id, revision, run_cipher, created_at, updated_at
         FROM role_skill_assessment_runs WHERE candidate_id = ? AND run_id = ?`,
      )
      .get(candidateId, runId) as AssessmentRunRow | undefined;
    return row ? this.fromRow(candidateId, row) : null;
  }

  list(candidateId: string): RoleSkillAssessmentRun[] {
    const rows = this.database
      .prepare(
        `SELECT run_id, revision, run_cipher, created_at, updated_at
         FROM role_skill_assessment_runs WHERE candidate_id = ?
         ORDER BY updated_at DESC, run_id`,
      )
      .all(candidateId) as unknown as AssessmentRunRow[];
    return rows.map((row) => this.fromRow(candidateId, row));
  }

  update(
    candidateId: string,
    input: RoleSkillAssessmentRun,
    expectedRevision: number,
  ): boolean {
    const run = parseRoleSkillAssessmentRun(input);
    if (run.revision !== expectedRevision + 1) {
      throw new Error('assessment_run_revision_invalid');
    }
    const result = this.database
      .prepare(
        `UPDATE role_skill_assessment_runs
         SET revision = ?, run_cipher = ?, updated_at = ?
         WHERE candidate_id = ? AND run_id = ? AND revision = ?`,
      )
      .run(
        run.revision,
        this.seal(candidateId, run.id, run),
        run.updatedAt,
        candidateId,
        run.id,
        expectedRevision,
      );
    return result.changes === 1;
  }

  private fromRow(candidateId: string, row: AssessmentRunRow): RoleSkillAssessmentRun {
    const run = parseRoleSkillAssessmentRun(
      JSON.parse(this.sealedText.open(row.run_cipher, associatedData(candidateId, row.run_id))) as unknown,
    );
    if (run.id !== row.run_id || run.revision !== row.revision) {
      throw new Error('assessment_run_record_mismatch');
    }
    return run;
  }

  private seal(candidateId: string, runId: string, run: RoleSkillAssessmentRun): string {
    return this.sealedText.seal(JSON.stringify(run), associatedData(candidateId, runId));
  }
}

function associatedData(candidateId: string, runId: string): string {
  return `candidate:${candidateId}:role-skill-assessment:${runId}`;
}
