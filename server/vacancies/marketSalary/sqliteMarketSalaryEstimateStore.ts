/**
 * B546: primary-key reads of the estimates the maintenance process wrote.
 * The web server never computes an estimate on a request.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../../data/sqliteBusyTimeout';
import type { MarketSalaryEstimate } from '../../../shared/marketSalaryEstimate';

export interface StoredMarketSalaryEstimate extends MarketSalaryEstimate {
  readonly computedAt: string;
}

interface EstimateRow {
  readonly low: number | null;
  readonly high: number | null;
  readonly currency: string;
  readonly sample_size: number;
  readonly computed_at: string;
}

export class SqliteMarketSalaryEstimateStore {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private statement: StatementSync | undefined;

  constructor(options: { readonly databasePath?: string; readonly database?: DatabaseSync }) {
    this.ownsDatabase = !options.database;
    this.database = options.database ?? new DatabaseSync(options.databasePath ?? ':memory:');
    if (this.ownsDatabase) applySqliteBusyTimeout(this.database);
  }

  /** Undefined when the key has no estimate or the table is not written yet. */
  get(key: string): StoredMarketSalaryEstimate | undefined {
    const statement = this.prepare();
    if (!statement) return undefined;
    const row = statement.get(key) as EstimateRow | undefined;
    if (!row) return undefined;
    return {
      ...(row.low !== null && row.high !== null ? { low: row.low, high: row.high } : {}),
      currency: row.currency,
      sampleSize: row.sample_size,
      computedAt: row.computed_at,
    };
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  private prepare(): StatementSync | undefined {
    if (this.statement) return this.statement;
    const exists = this.database
      .prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'market_salary_estimates'",
      )
      .get();
    if (!exists) return undefined;
    this.statement = this.database.prepare(
      'SELECT low, high, currency, sample_size, computed_at FROM market_salary_estimates WHERE key = ?',
    );
    return this.statement;
  }
}
