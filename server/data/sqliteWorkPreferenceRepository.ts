import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';
import type {
  WorkPreferenceAnswer,
  WorkFamilyCode,
  WorkPreferenceResult,
} from '../../shared/workPreferences';

/** Ответы кандидата вместе с версией ключа, по которой они посчитаны. */
export interface StoredWorkPreferenceRun {
  readonly keyVersion: string;
  readonly answers: readonly WorkPreferenceAnswer[];
  readonly excluded: readonly WorkFamilyCode[];
  readonly result: WorkPreferenceResult;
  readonly completedAt: string;
}

interface RunRow {
  key_version: string;
  run_cipher: string;
  completed_at: string;
}

/**
 * Хранит один — последний — прогон заданий на кандидата (B180, срез 3).
 *
 * Версия ключа лежит отдельным полем: формулировки заданий версионируются
 * вместе с ключом, и прогон по прежним словам нельзя выдавать за прогон по
 * новым. Читающая сторона сравнивает версии и говорит об этом вслух.
 */
export class SqliteWorkPreferenceRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  save(candidateId: string, run: StoredWorkPreferenceRun): StoredWorkPreferenceRun {
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO work_preference_runs
          (candidate_id, key_version, run_cipher, completed_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id) DO UPDATE SET
           key_version = excluded.key_version,
           run_cipher = excluded.run_cipher,
           completed_at = excluded.completed_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        run.keyVersion,
        this.sealedText.seal(JSON.stringify(run), associatedData(candidateId)),
        run.completedAt,
        now,
      );
    return run;
  }

  get(candidateId: string): StoredWorkPreferenceRun | null {
    const row = this.database
      .prepare(
        `SELECT key_version, run_cipher, completed_at FROM work_preference_runs
         WHERE candidate_id = ?`,
      )
      .get(candidateId) as RunRow | undefined;
    if (!row) return null;
    return JSON.parse(
      this.sealedText.open(row.run_cipher, associatedData(candidateId)),
    ) as StoredWorkPreferenceRun;
  }
}

/** Candidate-scoped, so a row can never be replayed under another candidate. */
function associatedData(candidateId: string): string {
  return `candidate:${candidateId}:work-preferences`;
}
