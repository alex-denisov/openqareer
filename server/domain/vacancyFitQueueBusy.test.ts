import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { isSqliteBusy } from '../data/sqliteBusyRetry';
import { queueRowsYielding } from '../routes/queueRowsYielding';
import type { VacancyFitInput } from './vacancyFit';
import { VacancyMechanicsRuntime } from './vacancyMechanicsRuntime';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function lockedRuntime() {
  const dir = mkdtempSync(join(tmpdir(), 'fit-queue-busy-'));
  const path = join(dir, 'db.sqlite');
  const runtime = new VacancyMechanicsRuntime(path, Buffer.alloc(32, 7));
  runtime.database.exec('PRAGMA busy_timeout = 20000');
  const other = new DatabaseSync(path);
  cleanups.push(() => {
    other.close();
    runtime.close();
    rmSync(dir, { recursive: true, force: true });
  });
  other.exec('BEGIN IMMEDIATE');
  return { runtime, other };
}

const row = (vacancyId: string): VacancyFitInput =>
  ({
    candidateId: 'candidate-a',
    vacancyId,
    description: 'Требования: опыт управления командой.',
    requirements: [],
    facts: [],
  }) as unknown as VacancyFitInput;

describe('fit queue behind a taken write lock (B702, prod 24.11: 3.2 s in the handler)', () => {
  it('a row fails as busy at once and keeps the connection wait', () => {
    const { runtime, other } = lockedRuntime();
    let failure: unknown;
    try {
      runtime.enqueue(row('v-1'));
    } catch (error) {
      failure = error;
    }
    expect(isSqliteBusy(failure)).toBe(true);
    expect(runtime.database.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 20000 });
    other.exec('ROLLBACK');
    expect(runtime.enqueue(row('v-1')).status).toBe('pending');
  });

  it('a page read answers without its requirements queued', () => {
    const { runtime } = lockedRuntime();
    expect(runtime.view(row('v-1')).state).toBe('not_requested');
  });

  it('the rows of a page wait off the loop: the timer that frees the lock runs', async () => {
    const { runtime, other } = lockedRuntime();
    setTimeout(() => other.exec('ROLLBACK'), 150);
    const queued: string[] = [];
    await queueRowsYielding(['v-1', 'v-2', 'v-3'], (id) => {
      queued.push(runtime.enqueue(row(id)).status);
    });
    expect(queued).toEqual(['pending', 'pending', 'pending']);
  });

  it('a failure that is not a lock is not retried', async () => {
    await expect(
      queueRowsYielding(['v-1'], () => {
        throw new Error('broken');
      }),
    ).rejects.toThrow('broken');
  });

  it('a slot taken while a row is queued joins its transaction', () => {
    const { runtime, other } = lockedRuntime();
    other.exec('ROLLBACK');
    runtime.enqueue(row('v-1'));
    runtime.database.exec('BEGIN IMMEDIATE');
    expect(runtime.takeFitRefreshSlot(5)).toBe(true);
    runtime.database.exec('ROLLBACK');
  });
});
