import type { DatabaseSync } from 'node:sqlite';
import {
  productCaseSubmissionSchema,
  workPreferenceSubmissionSchema,
  type AssessmentId,
  type AssessmentResult,
  type AssessmentSubmission,
  type ProductCaseResult,
  type WorkPreferenceResult,
} from '../domain/assessment';
import type { StoredAssessment } from './candidateStore';
import type { SealedText } from './sealedText';

interface AssessmentRow {
  assessment_id: AssessmentId;
  submission_cipher: string;
  result_cipher: string;
  completed_at: string;
  updated_at: string;
}

export class SqliteAssessmentRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  save(
    candidateId: string,
    assessmentId: AssessmentId,
    submission: AssessmentSubmission,
    result: AssessmentResult,
  ): StoredAssessment {
    const parsed = parseAssessment(assessmentId, submission, result);
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO assessments
          (candidate_id, assessment_id, submission_cipher, result_cipher,
           completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, assessment_id) DO UPDATE SET
           submission_cipher = excluded.submission_cipher,
           result_cipher = excluded.result_cipher,
           updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        assessmentId,
        this.seal(candidateId, assessmentId, 'submission', parsed.submission),
        this.seal(candidateId, assessmentId, 'result', parsed.result),
        now,
        now,
      );
    const stored = this.list(candidateId).find(
      (assessment) => assessment.assessmentId === assessmentId,
    );
    if (!stored) {
      throw new Error('assessment was not persisted');
    }
    return stored;
  }

  list(candidateId: string): StoredAssessment[] {
    const rows = this.database
      .prepare(
        `SELECT assessment_id, submission_cipher, result_cipher,
                completed_at, updated_at
         FROM assessments WHERE candidate_id = ?
         ORDER BY completed_at, assessment_id`,
      )
      .all(candidateId) as unknown as AssessmentRow[];
    return rows.map((row) => this.fromRow(candidateId, row));
  }

  private fromRow(
    candidateId: string,
    row: AssessmentRow,
  ): StoredAssessment {
    const submission = this.open(
      candidateId,
      row.assessment_id,
      'submission',
      row.submission_cipher,
    ) as AssessmentSubmission;
    const result = this.open(
      candidateId,
      row.assessment_id,
      'result',
      row.result_cipher,
    ) as AssessmentResult;
    return {
      assessmentId: row.assessment_id,
      ...parseAssessment(row.assessment_id, submission, result),
      completedAt: row.completed_at,
      updatedAt: row.updated_at,
    };
  }

  private seal(
    candidateId: string,
    assessmentId: AssessmentId,
    field: 'submission' | 'result',
    value: AssessmentSubmission | AssessmentResult,
  ): string {
    return this.sealedText.seal(
      JSON.stringify(value),
      associatedData(candidateId, assessmentId, field),
    );
  }

  private open(
    candidateId: string,
    assessmentId: AssessmentId,
    field: 'submission' | 'result',
    value: string,
  ): unknown {
    return JSON.parse(
      this.sealedText.open(
        value,
        associatedData(candidateId, assessmentId, field),
      ),
    ) as unknown;
  }
}

function associatedData(
  candidateId: string,
  assessmentId: AssessmentId,
  field: 'submission' | 'result',
): string {
  return `candidate:${candidateId}:assessment:${assessmentId}:${field}`;
}

function parseAssessment(
  assessmentId: AssessmentId,
  submission: AssessmentSubmission,
  result: AssessmentResult,
): { submission: AssessmentSubmission; result: AssessmentResult } {
  if (assessmentId === 'work-preferences-v1') {
    const parsedResult = result as WorkPreferenceResult;
    if (parsedResult.kind !== 'work-preferences' || parsedResult.version !== 1) {
      throw new AssessmentStateConflictError();
    }
    return {
      submission: workPreferenceSubmissionSchema.parse(submission),
      result: parsedResult,
    };
  }
  const parsedResult = result as ProductCaseResult;
  if (parsedResult.kind !== 'product-case' || parsedResult.version !== 1) {
    throw new AssessmentStateConflictError();
  }
  return {
    submission: productCaseSubmissionSchema.parse(submission),
    result: parsedResult,
  };
}

class AssessmentStateConflictError extends Error {}
