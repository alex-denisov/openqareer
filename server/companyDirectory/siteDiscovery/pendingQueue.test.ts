import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import { PLACEMENT_TABLES } from '../placement/placementSchema';
import { DIRECT_ATS_CHECK_TABLE } from './directAtsDiscovery';
import * as discovery from './siteDiscovery';
import { PendingQueue } from './siteDiscoverySchedule';

const HOUR = 60 * 60_000;

/** Обойдённые компании: без сайта не подходят, с сайтом и доской остаются в очереди навсегда. */
function directory(count: number, withSite: (index: number) => boolean): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
  db.exec(PLACEMENT_TABLES);
  db.exec(DIRECT_ATS_CHECK_TABLE);
  const add = db.prepare(`INSERT INTO company_directory (
    company_key, company_name, website_url, source_type, evidence, created_at, updated_at
  ) VALUES (?, ?, ?, 'linkedin_guest', '{"siteDiscovery":{"how":"B643-9"}}', '2026-11-09', '2026-11-09')`);
  for (let i = 0; i < count; i++) {
    const key = `c${String(i).padStart(5, '0')}`;
    add.run(key, key, withSite(i) ? 'https://x.example/' : null);
  }
  return db;
}

it('B761: вычитанная очередь не перечитывает справочник раньше срока', async () => {
  const db = directory(3, () => true);
  let now = 0;
  const queue = new PendingQueue(db, () => now, { prioritized: () => true });
  expect(await queue.next(10)).toHaveLength(3);
  now = 5 * HOUR;
  expect(await queue.next(10)).toEqual([]);
  now = 6 * HOUR + 1;
  expect(await queue.next(10)).toHaveLength(3);
  db.close();
});

it('B761: одно чтение смотрит окно ключей, а не ищет полную страницу по всему справочнику', async () => {
  const db = directory(1_200, (index) => index === 1_199);
  const turns = vi.spyOn(globalThis, 'setImmediate');
  const queue = new PendingQueue(db, () => 0, { prioritized: () => true });
  expect((await queue.next(10)).map((company) => company.companyKey)).toEqual(['c01199']);
  expect(turns.mock.calls.length).toBeGreaterThanOrEqual(3);
  turns.mockRestore();
  expect(discovery.readPendingPage(db, '', 500, 0, 'c00499')).toEqual([]);
  db.close();
});

it('B761: окно читается по первичному ключу, а не по индексу статуса всего справочника', () => {
  const db = directory(3, () => true);
  const prepare = vi.spyOn(db, 'prepare');
  discovery.readPendingPage(db, '', 500, 0, 'c00499');
  const sql = prepare.mock.calls.map(([text]) => text).find((text) => text.includes('FROM company_directory d'))!;
  prepare.mockRestore();
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('', 0, 'c00499', 500) as { detail: string }[];
  const walk = plan.find((step) => /(SEARCH|SCAN) d /.test(step.detail))!.detail;
  expect(walk).toContain('company_key>? AND company_key<?');
  db.close();
});
