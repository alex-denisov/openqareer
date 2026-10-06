import type { DatabaseSync } from 'node:sqlite';
import type { VectorAnswers, VectorId } from '../../src/features/strategy/careerVector';
import { MIGRATION_41 } from './careerVectorSchema';
import type { SealedText } from './sealedText';

export interface StoredCareerVector {
  readonly answers: VectorAnswers;
  readonly vector: VectorId | null;
  readonly rationale: {
    readonly runnerUp: VectorId | null;
    readonly confidence: 'none' | 'close' | 'clear';
    readonly reasons: readonly string[];
  };
  /** Всегда гипотеза: подтверждения как факта нет. */
  readonly status: 'hypothesis';
  readonly version: number;
  readonly updatedAt: string;
}

interface CareerVectorRow {
  answers_cipher: string;
  vector: string | null;
  rationale_json: string;
  version: number;
  updated_at: string;
}

/** Вектор перехода кандидата (B383). Ответы опроса хранятся запечатанными. */
export class SqliteCareerVectorRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(MIGRATION_41);
  }

  get(candidateId: string): StoredCareerVector | null {
    const row = this.database
      .prepare(
        `SELECT answers_cipher, vector, rationale_json, version, updated_at
         FROM candidate_career_vector WHERE candidate_id = ?`,
      )
      .get(candidateId) as unknown as CareerVectorRow | undefined;
    if (!row) return null;
    return {
      answers: JSON.parse(this.sealedText.open(row.answers_cipher, associatedData(candidateId))),
      vector: row.vector as VectorId | null,
      rationale: JSON.parse(row.rationale_json),
      status: 'hypothesis',
      version: row.version,
      updatedAt: row.updated_at,
    };
  }

  /** Пересмотр = новая запись с версией + 1; истории не ведём. */
  put(
    candidateId: string,
    input: {
      readonly answers: VectorAnswers;
      readonly vector: VectorId | null;
      readonly rationale: StoredCareerVector['rationale'];
    },
    now: string,
  ): StoredCareerVector {
    const cipher = this.sealedText.seal(JSON.stringify(input.answers), associatedData(candidateId));
    this.database
      .prepare(
        `INSERT INTO candidate_career_vector
           (candidate_id, answers_cipher, vector, rationale_json, status, version, updated_at)
         VALUES (?, ?, ?, ?, 'hypothesis', 1, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           answers_cipher = excluded.answers_cipher,
           vector = excluded.vector,
           rationale_json = excluded.rationale_json,
           status = 'hypothesis',
           version = candidate_career_vector.version + 1,
           updated_at = excluded.updated_at`,
      )
      .run(candidateId, cipher, input.vector, JSON.stringify(input.rationale), now);
    const stored = this.get(candidateId);
    if (!stored) throw new Error('career vector was not stored');
    return stored;
  }
}

function associatedData(candidateId: string): string {
  return `candidate:${candidateId}:career-vector`;
}
