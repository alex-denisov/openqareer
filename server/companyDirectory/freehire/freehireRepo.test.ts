import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import { importRepoChunk, parseRepoBoards, readRepoFile, usableName } from './freehireRepoImport';
import { checkRepoBoards, publicApiCounter } from './freehireRepoCheck';
import { readOffset, runRepoImportTick } from './freehireRepoSchedule';

function directory(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
  db.prepare(
    `INSERT INTO company_directory (company_key, company_name, website_url, source_type, created_at, updated_at)
     VALUES ('acme', 'Acme Inc.', 'https://acme.com/', 'corporate_portal', '2026-11-09', '2026-11-09')`,
  ).run();
  return db;
}

const NOW = new Date('2026-11-11T10:00:00Z');
const ROWS = parseRepoBoards(
  ['greenhouse\tacme\tAcme', 'lever\tglobex\tGlobex Corp', 'paylocity\tabc-guid\tInitech', 'greenhouse\tjobgether\tJobgether', 'lever\t123\t103644278', ''].join('\n'),
);

describe('B644 freehire repo catalog', () => {
  it('ships the whole catalog file with every row parsed', () => {
    const rows = readRepoFile();
    expect(rows.length).toBeGreaterThan(150_000);
    expect(rows.some((r) => r.provider === 'workday' && /^[a-z0-9-]+\/wd\d+\/[\w-]+$/i.test(r.board))).toBe(true);
    expect(rows.every((r) => !r.provider.startsWith('whatjobs') && r.provider !== 'hh')).toBe(true);
  });

  it('rejects ids and aggregators as company names', () => {
    expect(usableName('103644278')).toBe(false);
    expect(usableName('Jobgether')).toBe(false);
    expect(usableName('Initech')).toBe(true);
  });

  it('matches by name, adds new companies and records every board unconfirmed', () => {
    const db = directory();
    const totals = importRepoChunk(db, ROWS, 0, 100, NOW);
    expect(totals).toEqual({ read: 5, added: 2, matched: 1, skipped: 2 });
    const companies = db.prepare('SELECT company_key, ats_provider FROM company_directory ORDER BY company_key').all();
    expect(companies).toEqual([
      { company_key: 'acme', ats_provider: null },
      { company_key: 'globex', ats_provider: null },
      { company_key: 'initech', ats_provider: null },
    ]);
    const placements = db.prepare('SELECT placement_id, company_key FROM company_placement ORDER BY placement_id').all();
    expect(placements).toEqual([
      { placement_id: 'ats:greenhouse:acme', company_key: 'acme' },
      { placement_id: 'ats:lever:globex', company_key: 'globex' },
      { placement_id: 'ats:paylocity:abc-guid', company_key: 'initech' },
    ]);
  });

  it('walks the file in chunks and is idempotent on a rerun', () => {
    const db = directory();
    while (runRepoImportTick(db, ROWS, NOW).read > 0);
    expect(readOffset(db)).toBe(5);
    importRepoChunk(db, ROWS, 0, 100, NOW);
    expect(db.prepare('SELECT count(*) AS n FROM company_directory').get()).toEqual({ n: 3 });
  });

  it('promotes only boards whose public API lists jobs, up to the daily cap', async () => {
    const db = directory();
    importRepoChunk(db, ROWS, 0, 100, NOW);
    const jobs: Record<string, number> = { acme: 4, globex: 0 };
    const totals = await checkRepoBoards(db, async (_p, slug) => jobs[slug] ?? -1, 10, 100, () => NOW.getTime());
    expect(totals).toEqual({ checked: 2, withJobs: 1, dead: 0, promoted: 1 });
    expect(db.prepare("SELECT ats_provider, ats_slug FROM company_directory WHERE company_key = 'acme'").get()).toEqual({ ats_provider: 'greenhouse', ats_slug: 'acme' });
    expect(db.prepare("SELECT ats_provider FROM company_directory WHERE company_key = 'globex'").get()).toEqual({ ats_provider: null });
    const again = await checkRepoBoards(db, async () => 9, 10, 1, () => NOW.getTime());
    expect(again.checked).toBe(0);
  });

  it('reads Workday totals and BambooHR lists from their public endpoints', async () => {
    const seen: string[] = [];
    const fake = (async (url: string | URL | Request) => {
      seen.push(String(url));
      const body = String(url).includes('myworkdayjobs') ? { total: 42 } : { result: [{}, {}] };
      return new Response(JSON.stringify(body), { status: 200 });
    }) as typeof fetch;
    const count = publicApiCounter(fake);
    expect(await count('workday', 'carbonhealth/wd1/careers')).toBe(42);
    expect(await count('bamboohr', 'acme')).toBe(2);
    expect(await count('workday', 'not-a-slug')).toBe(-1);
    expect(seen).toEqual(['https://carbonhealth.wd1.myworkdayjobs.com/wday/cxs/carbonhealth/careers/jobs', 'https://acme.bamboohr.com/careers/list']);
  });
});
