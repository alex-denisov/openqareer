import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { runSqliteTransaction } from './sqliteTransaction';
import type { BulkLlmConfig } from '../providers/bulkLlmConfig';

/** Longer than one call's full retry window (3 x 60 s plus pauses), so a live call is never expired. */
const STALE_HOLD_TTL_MS = 15 * 60_000;

/** First day of the current UTC month: the month cap counts from here (B580). */
function monthStart(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}
/** The overrun mark names its model for the admin; no overrun mark closes anything (B580). */
function overrunKind(model: string): string {
  return `cost_exceeds_reservation:${model}`;
}
export class SqliteBulkLlmLedger {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(
      `PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS bulk_llm_spend(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,task TEXT NOT NULL,day TEXT NOT NULL,reserved REAL NOT NULL,cost REAL,model TEXT NOT NULL,provider TEXT NOT NULL,prompt_tokens INTEGER,cached_tokens INTEGER,completion_tokens INTEGER,batch_id TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS bulk_llm_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,created_at TEXT NOT NULL);`,
    );
  }
  event(kind: string) {
    this.db
      .prepare('INSERT INTO bulk_llm_events VALUES(?,?,?)')
      .run(randomUUID(), kind, new Date().toISOString());
  }
  private sum(where: string, ...values: string[]) {
    return Number(
      (
        this.db
          .prepare(
            `SELECT COALESCE(SUM(COALESCE(cost,reserved)),0) AS total FROM bulk_llm_spend WHERE ${where}`,
          )
          .get(...values) as { total: number }
      ).total,
    );
  }
  /**
   * A call that threw before settle (timeout, 5xx, worker stopped mid-call) left its hold at the
   * per-request cap, ~60x a real call; on prod 22.10 such holds took $0.54 of the $1 run (B556).
   * After the TTL the hold is charged at the dearest settled call of its task in the last day: an
   * upper bound of what the provider can have billed, never zero. Batch rows are left alone.
   */
  expireStaleHolds(now = Date.now()) {
    const cutoff = new Date(now - STALE_HOLD_TTL_MS).toISOString();
    const since = new Date(now - 86_400_000).toISOString();
    return Number(
      this.db
        .prepare(
          `UPDATE bulk_llm_spend AS hold SET status='expired',cost=MIN(hold.reserved,COALESCE((SELECT MAX(done.cost) FROM bulk_llm_spend AS done
            WHERE done.task=hold.task AND done.status='settled' AND done.created_at>=?),hold.reserved))
          WHERE hold.status='reserved' AND hold.cost IS NULL AND hold.batch_id IS NULL AND hold.created_at<?`,
        )
        .run(since, cutoff).changes,
    );
  }
  reserve(
    input: { runId: string; task: string; model: string; provider: string },
    config: BulkLlmConfig,
    amount = config.perRequestUsd,
  ) {
    return runSqliteTransaction(this.db, () => {
      this.expireStaleHolds();
      const day = new Date().toISOString().slice(0, 10);
      // A charge above its hold is recorded at its real price and leaves an event for the admin;
      // it no longer stops the channel. The caps below count real charges, so they still hold.
      // A latch here stopped every fit for hours after one Vertex call at $0.0101 over a $0.01
      // hold (28.10, B580).
      if (
        this.sum('(day>=? OR cost IS NULL)', monthStart()) + amount > config.monthUsd ||
        this.sum('run_id=?', input.runId) + amount > config.runUsd ||
        this.sum('(day=? OR cost IS NULL)', day) + amount > config.dayUsd
      ) {
        this.event('budget_exceeded');
        return null;
      }
      const id = randomUUID();
      this.db
        .prepare(
          'INSERT INTO bulk_llm_spend(id,run_id,task,day,reserved,model,provider,status,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          input.runId,
          input.task,
          day,
          amount,
          input.model,
          input.provider,
          'reserved',
          new Date().toISOString(),
        );
      return id;
    });
  }
  settle(
    id: string,
    usage: { cost: number; promptTokens: number; cachedTokens: number; completionTokens: number },
    actual?: { model?: string; provider?: string },
  ) {
    runSqliteTransaction(this.db, () => {
      const row = this.db
        .prepare('SELECT reserved,cost,model FROM bulk_llm_spend WHERE id=?')
        .get(id) as { reserved: number; cost: number | null; model: string } | undefined;
      if (!row) throw new Error('Unknown reservation');
      if (row.cost !== null) return;
      if (usage.cost > row.reserved) {
        this.event(overrunKind(row.model));
        // The journal names the overrun at once; the admin spend page lists the event too.
        console.warn(
          JSON.stringify({ msg: 'bulk-llm-cost-exceeds-reservation', model: row.model, reserved: row.reserved, cost: usage.cost }),
        );
      }
      this.db
        .prepare(
          "UPDATE bulk_llm_spend SET cost=?,prompt_tokens=?,cached_tokens=?,completion_tokens=?,day=?,model=COALESCE(?,model),provider=COALESCE(?,provider),status='settled' WHERE id=? AND cost IS NULL",
        )
        .run(
          usage.cost,
          usage.promptTokens,
          usage.cachedTokens,
          usage.completionTokens,
          new Date().toISOString().slice(0, 10),
          actual?.model ?? null,
          actual?.provider ?? null,
          id,
        );
    });
  }
  release(id: string) {
    this.db
      .prepare("UPDATE bulk_llm_spend SET cost=0,status='rejected' WHERE id=? AND cost IS NULL")
      .run(id);
  }
  pendingBatch(id: string, batchId: string) {
    this.db
      .prepare("UPDATE bulk_llm_spend SET batch_id=?,status='pending' WHERE id=?")
      .run(batchId, id);
  }
  reservation(id: string) {
    return this.db.prepare('SELECT * FROM bulk_llm_spend WHERE id=?').get(id);
  }
  status(config: BulkLlmConfig | null) {
    this.expireStaleHolds();
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(CASE WHEN day>=? THEN cost ELSE 0 END),0) spent,COALESCE(SUM(CASE WHEN cost IS NULL THEN reserved ELSE 0 END),0) held FROM bulk_llm_spend',
      )
      .get(monthStart()) as { spent: number; held: number };
    return {
      enabled: !!config,
      dayRemainingUsd: config
        ? Math.max(
            0,
            config.dayUsd -
              this.sum('(day=? OR cost IS NULL)', new Date().toISOString().slice(0, 10)),
          )
        : 0,
      runs: this.db
        .prepare(
          'SELECT run_id,COALESCE(SUM(cost),0) spentUsd,COALESCE(SUM(CASE WHEN cost IS NULL THEN reserved ELSE 0 END),0) heldUsd FROM bulk_llm_spend GROUP BY run_id ORDER BY MAX(created_at) DESC LIMIT 50',
        )
        .all()
        .map((row) => ({
          ...row,
          remainingUsd: config
            ? Math.max(0, config.runUsd - Number(row.spentUsd) - Number(row.heldUsd))
            : 0,
        })),
      spentUsd: row.spent,
      heldUsd: row.held,
      remainingUsd: config ? Math.max(0, config.monthUsd - row.spent - row.held) : 0,
      limits: config
        ? {
            runUsd: config.runUsd,
            dayUsd: config.dayUsd,
            monthUsd: config.monthUsd,
            perRequestUsd: config.perRequestUsd,
          }
        : null,
      events: this.db
        .prepare('SELECT kind,created_at FROM bulk_llm_events ORDER BY created_at DESC LIMIT 30')
        .all(),
    };
  }
  close() {
    this.db.close();
  }
}
