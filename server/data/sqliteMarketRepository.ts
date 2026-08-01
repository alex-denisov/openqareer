import type { DatabaseSync } from 'node:sqlite';
import {
  germanyMarketSubmissionSchema,
  type GermanyMarketResult,
  type GermanyMarketSubmission,
} from '../domain/germanyMarket';
import type { StoredGermanyMarket } from './candidateStore';
import type { SealedText } from './sealedText';

interface MarketRow {
  submission_cipher: string;
  result_cipher: string;
  created_at: string;
  updated_at: string;
}

export class SqliteMarketRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {}

  save(
    candidateId: string,
    submission: GermanyMarketSubmission,
    result: GermanyMarketResult,
  ): StoredGermanyMarket {
    const parsedSubmission = germanyMarketSubmissionSchema.parse(submission);
    if (result.country !== 'DE') throw new Error('invalid market result');
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO market_profiles
        (candidate_id, country, submission_cipher, result_cipher, created_at, updated_at)
       VALUES (?, 'DE', ?, ?, ?, ?)
       ON CONFLICT(candidate_id, country) DO UPDATE SET
         submission_cipher = excluded.submission_cipher,
         result_cipher = excluded.result_cipher,
         updated_at = excluded.updated_at`,
    ).run(
      candidateId,
      this.seal(candidateId, 'submission', parsedSubmission),
      this.seal(candidateId, 'result', result),
      now,
      now,
    );
    const stored = this.get(candidateId);
    if (!stored) throw new Error('market profile was not persisted');
    return stored;
  }

  get(candidateId: string): StoredGermanyMarket | null {
    const row = this.database.prepare(
      `SELECT submission_cipher, result_cipher, created_at, updated_at
       FROM market_profiles WHERE candidate_id = ? AND country = 'DE'`,
    ).get(candidateId) as MarketRow | undefined;
    if (!row) return null;
    const submission = germanyMarketSubmissionSchema.parse(
      this.open(candidateId, 'submission', row.submission_cipher),
    );
    const result = this.open(
      candidateId,
      'result',
      row.result_cipher,
    ) as GermanyMarketResult;
    if (result.country !== 'DE' || result.packVersion !== 'DE-2026.1') {
      throw new Error('invalid stored market result');
    }
    return {
      country: 'DE',
      submission,
      result,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private seal(
    candidateId: string,
    field: 'submission' | 'result',
    value: GermanyMarketSubmission | GermanyMarketResult,
  ): string {
    return this.sealedText.seal(
      JSON.stringify(value),
      associatedData(candidateId, field),
    );
  }

  private open(
    candidateId: string,
    field: 'submission' | 'result',
    value: string,
  ): unknown {
    return JSON.parse(
      this.sealedText.open(value, associatedData(candidateId, field)),
    ) as unknown;
  }
}

function associatedData(
  candidateId: string,
  field: 'submission' | 'result',
): string {
  return `candidate:${candidateId}:market:DE:${field}`;
}
