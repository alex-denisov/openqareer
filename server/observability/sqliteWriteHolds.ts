import { DatabaseSync, StatementSync } from 'node:sqlite';

/** Контракт записи пула — 100 мс на транзакцию; пишем то, что заметно другому процессу. */
export const LONG_WRITE_HOLD_MS = 500;

export interface WriteHold {
  readonly heldMs: number;
  /** Ожидание чужой записи перед BEGIN IMMEDIATE; в `heldMs` не входит. */
  readonly lockWaitMs: number;
  /** Первая запись: действие и таблица. Текста запроса и значений здесь нет. */
  readonly statement: string;
  readonly writes: number;
  /** Запись без BEGIN IMMEDIATE: её время нельзя отделить от ожидания блокировки. */
  readonly waitIncluded: boolean;
  /** Кто держал; сборка минифицирована, имена восстанавливаются по карте. */
  readonly frames: readonly string[];
}

const WRITE_STATEMENT =
  /^\s*(INSERT(?:\s+OR\s+\w+)?\s+INTO|REPLACE\s+INTO|UPDATE(?:\s+OR\s+\w+)?|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+\w+(?:\s+IF\s+EXISTS)?|CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?)\s+["`]?(\w+)/iu;

function writeLabel(sql: string): string | null {
  const match = WRITE_STATEMENT.exec(sql);
  return match ? `${match[1]!.toUpperCase().replace(/\s+/gu, ' ')} ${match[2]}` : null;
}

/** Сборка минифицирована, поэтому верх стека не отсеять по имени: кадры обёртки остаются в строке. */
function callerFrames(): string[] {
  return (new Error().stack ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('at '))
    .slice(1, 9)
    .map((line) => line.replace(/(?:file:\/\/)?\/[^\s)]*\//u, ''));
}

interface OpenTransaction {
  readonly lockWaitMs: number;
  /** Момент получения блокировки; у отложенного BEGIN — начало первой записи. */
  readonly lockedAt: number | null;
  readonly statement: string | null;
  readonly writes: number;
}

class WriteHoldTracker {
  private readonly open = new WeakMap<DatabaseSync, OpenTransaction>();

  constructor(
    private readonly onHold: (hold: WriteHold) => void,
    private readonly thresholdMs: number,
  ) {}

  afterExec(database: DatabaseSync, sql: string, startedAt: number): void {
    const at = performance.now();
    if (/^\s*BEGIN\b/iu.test(sql) && database.isTransaction && !this.open.has(database)) {
      const immediate = /^\s*BEGIN\s+(?:IMMEDIATE|EXCLUSIVE)\b/iu.test(sql);
      this.open.set(database, {
        lockWaitMs: immediate ? at - startedAt : 0,
        lockedAt: immediate ? at : null,
        statement: null,
        writes: 0,
      });
      return;
    }
    const label = writeLabel(sql);
    if (label) this.noteWrite(database, label, startedAt);
    this.closeIfEnded(database, at);
  }

  noteWrite(database: DatabaseSync, label: string, startedAt: number): void {
    const current = this.open.get(database);
    if (!current) {
      this.report({
        heldMs: performance.now() - startedAt,
        lockWaitMs: 0,
        statement: label,
        writes: 1,
        waitIncluded: true,
      });
      return;
    }
    this.open.set(database, {
      ...current,
      lockedAt: current.lockedAt ?? startedAt,
      statement: current.statement ?? label,
      writes: current.writes + 1,
    });
  }

  private closeIfEnded(database: DatabaseSync, at: number): void {
    const current = this.open.get(database);
    if (!current || database.isTransaction) return;
    this.open.delete(database);
    if (current.lockedAt === null || current.statement === null) return;
    this.report({
      heldMs: at - current.lockedAt,
      lockWaitMs: current.lockWaitMs,
      statement: current.statement,
      writes: current.writes,
      waitIncluded: false,
    });
  }

  private report(hold: Omit<WriteHold, 'frames'>): void {
    if (hold.heldMs >= this.thresholdMs) this.onHold({ ...hold, frames: callerFrames() });
  }
}

/**
 * PRB-041: удержания записи 2–4 с в 09:47 и 09:49 остались без имени: журнал
 * пула видит только свои транзакции, а обслуживатель пишет и другими путями.
 * Смотрим на все соединения процесса разом. Времени это почти не стоит: разбор
 * SQL только на подготовке запроса и замер на записях; чтения не считаются.
 */
export function watchWriteHolds(
  onHold: (hold: WriteHold) => void,
  thresholdMs: number = LONG_WRITE_HOLD_MS,
): () => void {
  const database = DatabaseSync.prototype;
  const statement = StatementSync.prototype;
  const { exec, prepare } = database;
  const { run, get, all } = statement;
  const tracker = new WriteHoldTracker(onHold, thresholdMs);
  const prepared = new WeakMap<StatementSync, { database: DatabaseSync; label: string }>();

  database.exec = function (this: DatabaseSync, sql: string): void {
    const startedAt = performance.now();
    exec.call(this, sql);
    tracker.afterExec(this, sql, startedAt);
  };
  database.prepare = function (this: DatabaseSync, sql: string, ...rest: unknown[]) {
    const created = (prepare as (...args: unknown[]) => StatementSync).call(this, sql, ...rest);
    const label = writeLabel(sql);
    if (label) prepared.set(created, { database: this, label });
    return created;
  } as DatabaseSync['prepare'];
  const timed = <M extends StatementSync['run' | 'get' | 'all']>(method: M): M =>
    function (this: StatementSync, ...args: unknown[]) {
      const call = method as unknown as (...params: unknown[]) => unknown;
      const write = prepared.get(this);
      if (!write) return call.apply(this, args);
      const startedAt = performance.now();
      const result = call.apply(this, args);
      tracker.noteWrite(write.database, write.label, startedAt);
      return result;
    } as unknown as M;
  statement.run = timed(run);
  statement.get = timed(get);
  statement.all = timed(all);

  return () => {
    Object.assign(database, { exec, prepare });
    Object.assign(statement, { run, get, all });
  };
}
