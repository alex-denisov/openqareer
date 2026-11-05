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
    this.ensureColumn('failure', 'TEXT');
    this.ensureColumn('duration_ms', 'INTEGER');
    this.ensureVertexIndexes();
  }
  /**
   * The Vertex gate sums `provider='gemini'` rows by `created_at` and looks events up by kind on every
   * call. `IF NOT EXISTS` on an existing index is instant; the first build covers a table of
   * ~100 000 rows (about 5 000 a day), not the 3.8 GB database.
   */
  private ensureVertexIndexes() {
    this.db.exec(
      'CREATE INDEX IF NOT EXISTS bulk_llm_spend_provider_created ON bulk_llm_spend(provider, created_at); CREATE INDEX IF NOT EXISTS bulk_llm_events_kind_created ON bulk_llm_events(kind, created_at);',
    );
  }
  /**
   * `failure`: why a call was refused (04.11: 1 933 GLM rows `rejected` and no reason anywhere).
   * `duration_ms`: how long a Vertex call took (04.11: timeouts rose at night and nothing showed why).
   * Instant, repeat is safe.
   */
  private ensureColumn(name: string, type: string) {
    const columns = this.db.prepare('PRAGMA table_info(bulk_llm_spend)').all() as { name: string }[];
    if (columns.some((column) => column.name === name)) return;
    try {
      this.db.exec(`ALTER TABLE bulk_llm_spend ADD COLUMN ${name} ${type}`);
    } catch (error) {
      // Another process of the same deploy added it first.
      if (!(error instanceof Error) || !/duplicate column/u.test(error.message)) throw error;
    }
  }
  event(kind: string) {
    this.db
      .prepare('INSERT INTO bulk_llm_events VALUES(?,?,?)')
      .run(randomUUID(), kind, new Date().toISOString());
  }
  /** True for the first caller of a UTC day across processes and restarts. */
  firstToday(kind: string): boolean {
    const now = new Date().toISOString();
    return (
      Number(
        this.db
          .prepare('INSERT OR IGNORE INTO bulk_llm_events VALUES(?,?,?)')
          .run(`${kind}:${now.slice(0, 10)}`, kind, now).changes,
      ) === 1
    );
  }
  private sum(where: string, ...values: string[]) {
    return Number(
      (
        this.db
          .prepare(
            `SELECT COALESCE(SUM(COALESCE(cost,reserved)),0) AS total FROM bulk_llm_spend WHERE ${where} AND provider<>'gemini'`,
          )
          .get(...values) as { total: number }
      ).total,
    );
  }
  /**
   * A call that threw before settle (timeout, 5xx, worker stopped mid-call) left its hold at the
   * per-request cap, ~60x a real call; on prod 22.10 such holds took $0.54 of the $1 run (B556).
   * After the TTL the hold is charged at the average settled call of its task in the last day. At the
   * dearest call the 631 November rows came to $5.85 against at most $0.6 billed by OpenRouter (04.11)
   * and took that from the day cap. Batch rows are left alone.
   */
  expireStaleHolds(now = Date.now()) {
    const cutoff = new Date(now - STALE_HOLD_TTL_MS).toISOString();
    const since = new Date(now - 86_400_000).toISOString();
    return Number(
      this.db
        .prepare(
          `UPDATE bulk_llm_spend AS hold SET status='expired',cost=MIN(hold.reserved,COALESCE((SELECT AVG(done.cost) FROM bulk_llm_spend AS done
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
  release(id: string, failure?: string) {
    this.db
      .prepare(
        "UPDATE bulk_llm_spend SET cost=0,status='rejected',failure=? WHERE id=? AND cost IS NULL",
      )
      .run(failure ?? null, id);
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
        'SELECT COALESCE(SUM(CASE WHEN day>=? THEN cost ELSE 0 END),0) spent,COALESCE(SUM(CASE WHEN cost IS NULL THEN reserved ELSE 0 END),0) held FROM bulk_llm_spend WHERE provider<>\'gemini\'',
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
          'SELECT run_id,COALESCE(SUM(cost),0) spentUsd,COALESCE(SUM(CASE WHEN cost IS NULL THEN reserved ELSE 0 END),0) heldUsd FROM bulk_llm_spend WHERE provider<>\'gemini\' GROUP BY run_id ORDER BY MAX(created_at) DESC LIMIT 50',
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
  /**
   * Vertex calls of the candidate chains (04.11) keep their own books: `provider='gemini'` rows are
   * left out of every OpenRouter sum above, so they never close the channel or touch its latch.
   */
  geminiDaySpentUsd(day = new Date().toISOString().slice(0, 10)): number {
    return Number(
      (
        this.db
          .prepare(
            "SELECT COALESCE(SUM(COALESCE(cost,reserved)),0) AS total FROM bulk_llm_spend WHERE provider='gemini' AND day=?",
          )
          .get(day) as { total: number }
      ).total,
    );
  }
  /**
   * Vertex spend for the gate in one pass: `creditUsd` from `sinceIso`, `dayUsd` and `taskDayUsd` from
   * the start of the UTC day (`dayStartIso`). Rows are compared by `created_at` (ISO with `T`).
   */
  vertexSpend(options: { sinceIso: string; dayStartIso: string; task?: string }): {
    creditUsd: number;
    dayUsd: number;
    taskDayUsd: number;
  } {
    const lower = options.sinceIso < options.dayStartIso ? options.sinceIso : options.dayStartIso;
    const row = this.db
      .prepare(
        `SELECT
          COALESCE(SUM(CASE WHEN created_at>=? THEN COALESCE(cost,reserved) END),0) AS credit,
          COALESCE(SUM(CASE WHEN created_at>=? THEN COALESCE(cost,reserved) END),0) AS day,
          COALESCE(SUM(CASE WHEN created_at>=? AND task=? THEN COALESCE(cost,reserved) END),0) AS taskDay
        FROM bulk_llm_spend WHERE provider='gemini' AND created_at>=?`,
      )
      .get(options.sinceIso, options.dayStartIso, options.dayStartIso, options.task ?? '', lower) as {
      credit: number;
      day: number;
      taskDay: number;
    };
    return {
      creditUsd: Number(row.credit),
      dayUsd: Number(row.day),
      taskDayUsd: Number(row.taskDay),
    };
  }
  /** True when an event of this kind was written at or after `sinceIso` (by any process). */
  eventSince(kind: string, sinceIso: string): boolean {
    return (
      this.db
        .prepare('SELECT 1 AS hit FROM bulk_llm_events WHERE kind=? AND created_at>=? LIMIT 1')
        .get(kind, sinceIso) !== undefined
    );
  }
  /**
   * One finished Vertex call, written at once (no hold: the gate checks the caps before the call).
   * A refusal is `rejected` with cost 0 and the masked reason; an answer is `settled`. Returns the row id.
   */
  recordGeminiCall(
    input: { task: string; model: string; failure?: string; rejected?: boolean; durationMs?: number },
    usage: { cost: number; promptTokens: number; cachedTokens: number; completionTokens: number },
  ): string {
    const now = new Date().toISOString();
    const day = now.slice(0, 10);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO bulk_llm_spend(id,run_id,task,day,reserved,cost,model,provider,prompt_tokens,cached_tokens,completion_tokens,status,created_at,failure,duration_ms) VALUES(?,?,?,?,?,?,?,'gemini',?,?,?,?,?,?,?)",
      )
      .run(
        id,
        `gemini-${day}`,
        input.task,
        day,
        usage.cost,
        usage.cost,
        input.model,
        usage.promptTokens,
        usage.cachedTokens,
        usage.completionTokens,
        input.rejected ? 'rejected' : 'settled',
        now,
        input.failure ?? null,
        input.durationMs ?? null,
      );
    return id;
  }
  /** The money was spent and the answer was unusable: the row keeps its cost and says why. */
  markGeminiFailure(id: string, failure: string) {
    this.db.prepare("UPDATE bulk_llm_spend SET failure=? WHERE id=? AND provider='gemini'").run(failure, id);
  }
  close() {
    this.db.close();
  }
}
