import { spawn, type ChildProcess } from 'node:child_process';
import type { SQLInputValue } from 'node:sqlite';

// Keep this worker self-contained so bundled production and tsx development
// run identical code without a second executable or a TypeScript loader.
const WORKER_SOURCE = `
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1], { readOnly: true });
db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 1000;');
process.on('message', ({ id, sql, params }) => {
  try { process.send({ id, rows: db.prepare(sql).all(...params) }); }
  catch { process.send({ id, error: 'vacancy_match_query_failed' }); }
});
`;

type Row = { payload: string };

/** What the pool store needs from a reader; tests inject a synchronous stand-in. */
export interface MatchRowReader {
  read(sql: string, params: SQLInputValue[]): Promise<Row[]>;
  close(): void;
}
type Pending = {
  resolve: (rows: Row[]) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

/** One bounded reader isolates slow SQLite/disk work from auth and HTTP. */
export class VacancyMatchReader implements MatchRowReader {
  private worker?: ChildProcess;
  private sequence = 0;
  private closed = false;
  private readonly pending = new Map<number, Pending>();

  constructor(
    private readonly databasePath: string,
    private readonly timeoutMs = 12_000,
    private readonly maxPending = 8,
  ) {}

  read(sql: string, params: SQLInputValue[]): Promise<Row[]> {
    if (this.closed) return Promise.reject(new Error('vacancy_match_reader_closed'));
    if (this.pending.size >= this.maxPending) {
      return Promise.reject(new Error('vacancy_match_reader_busy'));
    }
    const worker = this.worker ?? this.startWorker();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.stopWorker('vacancy_match_timeout'), this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      worker.ref();
      worker.send?.({ id, sql, params });
    });
  }

  private startWorker(): ChildProcess {
    const worker = spawn(process.execPath, ['-e', WORKER_SOURCE, this.databasePath], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'advanced',
    });
    this.worker = worker;
    worker.on('message', (message: { id: number; rows?: Row[]; error?: string }) => {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(message.id);
      if (message.error || !message.rows) pending.reject(new Error('vacancy_match_query_failed'));
      else pending.resolve(message.rows);
      if (!this.pending.size) worker.unref();
    });
    worker.on('error', () => {
      if (this.worker === worker) this.stopWorker('vacancy_match_worker_failed');
    });
    worker.on('exit', () => {
      if (this.worker === worker) this.stopWorker('vacancy_match_worker_exited');
    });
    worker.unref();
    return worker;
  }

  private stopWorker(reason: string): void {
    const worker = this.worker;
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
    // SIGKILL interrupts running native SQLite too; a Promise timeout alone
    // would leave the expensive query consuming disk and the reader occupied.
    if (worker) worker.kill('SIGKILL');
  }

  close(): void {
    this.closed = true;
    this.stopWorker('vacancy_match_reader_closed');
  }
}
