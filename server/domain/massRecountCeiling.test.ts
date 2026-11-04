import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VacancyMechanicsRuntime } from './vacancyMechanicsRuntime';
import { takeMassRecountSlot } from '../data/massRecountDaily';

const DAY_ONE = Date.parse('2026-11-04T10:00:00.000Z');
const DAY_TWO = Date.parse('2026-11-05T00:00:30.000Z');
const LIMITS = { requirements: 5000, fit: 5000 };
const FAILED = 12000;

describe('mass recount ceiling per UTC day (prod 01-02.11: $9.9 and $13.4 a day)', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const close of cleanup.splice(0)) close(); });
  function setup() {
    const directory = mkdtempSync(join(tmpdir(), 'oq-mass-recount-'));
    const runtime = new VacancyMechanicsRuntime(join(directory, 'mechanics.sqlite'), Buffer.alloc(32, 8), () => true);
    cleanup.push(() => { runtime.close(); rmSync(directory, { recursive: true, force: true }); });
    return runtime;
  }
  function seed(runtime: VacancyMechanicsRuntime) {
    runtime.database.exec('BEGIN');
    const fit = runtime.database.prepare(`INSERT INTO vacancy_fit_queue(cache_key,candidate_key,input_cipher,status,attempts,created_at,updated_at,last_error,requeue_revision)
      VALUES(?,?,?,?,3,?,?,?,1)`);
    const requirements = runtime.database.prepare(`INSERT INTO vacancy_requirements_jobs(id,cache_key,input_json,status,attempts,last_error,created_at,updated_at,requeue_revision)
      VALUES(?,?,?,?,3,'requirements_model_invalid',1,1,1)`);
    for (let index = 0; index < FAILED; index += 1) {
      fit.run(`k${index}`, 'c', 'cipher', 'failed', '2026-10-01T00:00:00.000Z', '2026-10-01T00:00:00.000Z', 'profile_changed');
      requirements.run(`j${index}`, `rk${index}`, `{"vacancyId":"v${index}","description":"d"}`, 'failed');
    }
    runtime.database.exec('COMMIT');
  }
  const count = (runtime: VacancyMechanicsRuntime, table: string, status: string) =>
    (runtime.database.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE status=?`).get(status) as { n: number }).n;
  const options = (now: number) => ({ limits: LIMITS, now, log: { info: vi.fn(), warn: vi.fn() } });

  it('returns 5000 per kind on the first start, 0 on the second the same day, 5000 more the next day', () => {
    const runtime = setup();
    seed(runtime);
    const first = options(DAY_ONE);
    expect(runtime.requeueAfterParserUpgrade(first)).toMatchObject({ requirements: 5000, fit: 5000 });
    expect(runtime.requeueAfterParserUpgrade(options(DAY_ONE + 60_000))).toMatchObject({ requirements: 0, fit: 0 });
    expect(runtime.requeueAfterParserUpgrade(options(DAY_TWO))).toMatchObject({ requirements: 5000, fit: 5000 });
    // None lost: returned + still waiting = all of them; attempts reset only on the returned rows.
    expect(count(runtime, 'vacancy_fit_queue', 'pending')).toBe(10000);
    expect(count(runtime, 'vacancy_fit_queue', 'failed')).toBe(FAILED - 10000);
    expect(count(runtime, 'vacancy_requirements_jobs', 'queued')).toBe(10000);
    expect(count(runtime, 'vacancy_requirements_jobs', 'failed')).toBe(FAILED - 10000);
    const reset = (runtime.database.prepare(`SELECT COUNT(*) AS n FROM vacancy_fit_queue WHERE status='pending' AND attempts=0`).get() as { n: number }).n;
    const kept = (runtime.database.prepare(`SELECT COUNT(*) AS n FROM vacancy_fit_queue WHERE status='failed' AND attempts=3`).get() as { n: number }).n;
    expect([reset, kept]).toEqual([10000, FAILED - 10000]);
  }, 60_000);

  it('writes one info line per kind at every start, also at zero, and a warning at the ceiling', () => {
    const runtime = setup();
    const empty = options(DAY_ONE);
    runtime.requeueAfterParserUpgrade(empty);
    expect(empty.log.info).toHaveBeenCalledTimes(2);
    expect(empty.log.info.mock.calls.map(([line]) => line).join('\n')).toMatch(/requirements.*requeued=0.*remaining=0.*limit=5000/su);
    expect(empty.log.warn).not.toHaveBeenCalled();
    seed(runtime);
    const full = options(DAY_ONE);
    runtime.requeueAfterParserUpgrade(full);
    expect(full.log.warn).toHaveBeenCalledWith(expect.stringMatching(/^mass-recount-ceiling kind=requirements queued=5000 limit=5000 remaining=7000/u));
    expect(full.log.warn).toHaveBeenCalledWith(expect.stringMatching(/^mass-recount-ceiling kind=fit queued=5000 limit=5000 remaining=7000/u));
    const again = options(DAY_ONE + 1000);
    runtime.requeueAfterParserUpgrade(again);
    expect(again.log.info.mock.calls.map(([line]) => line).join('\n')).toMatch(/kind=fit requeued=0 remaining=7000 limit=5000/u);
  }, 60_000);

  it('the background refresh of counted rows stops at its ceiling; the count survives a new connection', () => {
    const runtime = setup();
    const taken = Array.from({ length: 4 }, () => takeMassRecountSlot(runtime.database, 'fit_refresh', 3, DAY_ONE));
    expect(taken).toEqual([true, true, true, false]);
    expect(takeMassRecountSlot(runtime.database, 'fit_refresh', 3, DAY_TWO)).toBe(true);
  });
});
