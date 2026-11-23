import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../../data/companyDirectorySchema';
import { LinkedinOrgStore, NEW_ROWS_RESCAN_MS } from './linkedinOrgStore';

const NOW = new Date('2026-11-23T03:00:00Z');

function directory(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  return db;
}

function addCompany(db: DatabaseSync, key: string, site: string | null): void {
  db.prepare(
    `INSERT INTO company_directory (company_key, company_name, website_url, source_type, created_at, updated_at)
     VALUES (?, ?, ?, 'freehire', 'x', 'x')`,
  ).run(key, key, site);
}

/** Reads the queue to the end, recording each row as checked. */
function drain(store: LinkedinOrgStore, now: Date): string[] {
  const seen: string[] = [];
  for (let row = store.nextDue(now); row; row = store.nextDue(now)) {
    seen.push(row.companyKey);
    store.record(row.companyKey, { status: 'no_page', reason: 'test' }, now);
  }
  return seen;
}

describe('LinkedinOrgStore.nextDue keyset read (B761)', () => {
  it('walks new rows once, skipping rows without a site or LinkedIn link', () => {
    const db = directory();
    for (let i = 0; i < 50; i += 1)
      addCompany(
        db,
        `co-${String(i).padStart(2, '0')}`,
        i % 5 === 0 ? `https://s${i}.example/` : null,
      );
    const store = new LinkedinOrgStore(db);
    expect(drain(store, NOW)).toEqual([
      'co-00',
      'co-05',
      'co-10',
      'co-15',
      'co-20',
      'co-25',
      'co-30',
      'co-35',
      'co-40',
      'co-45',
    ]);
  });

  it('reads new rows without sorting the whole directory', () => {
    const store = new LinkedinOrgStore(directory());
    const plans = store.nextDuePlans(NOW).join('\n');
    expect(plans).not.toMatch(/TEMP B-TREE/);
  });

  it('picks up a company added behind the walk at once, and one that gains a site on the next lap', () => {
    const db = directory();
    addCompany(db, 'm-old', null);
    addCompany(db, 'z-first', 'https://z.example/');
    const store = new LinkedinOrgStore(db);
    expect(drain(store, NOW)).toEqual(['z-first']);
    addCompany(db, 'a-new', 'https://a.example/');
    expect(drain(store, NOW)).toEqual(['a-new']);
    db.prepare(
      `UPDATE company_directory SET website_url = 'https://m.example/' WHERE company_key = 'm-old'`,
    ).run();
    expect(drain(store, new Date(NOW.getTime() + 60_000))).toEqual([]);
    expect(drain(store, new Date(NOW.getTime() + NEW_ROWS_RESCAN_MS))).toEqual(['m-old']);
  });

  it('keeps a row queued when it was read but not recorded', () => {
    const db = directory();
    addCompany(db, 'a', 'https://a.example/');
    addCompany(db, 'b', 'https://b.example/');
    const store = new LinkedinOrgStore(db);
    expect(store.nextDue(NOW)?.companyKey).toBe('a');
    expect(store.nextDue(NOW)?.companyKey).toBe('a');
  });

  it('returns due retries after new rows, oldest retry first', () => {
    const db = directory();
    addCompany(db, 'a', 'https://a.example/');
    addCompany(db, 'b', 'https://b.example/');
    const store = new LinkedinOrgStore(db);
    store.record(
      'b',
      { status: 'retry_after', reason: 't', retryAt: '2026-11-23T01:00:00.000Z' },
      NOW,
    );
    store.record(
      'a',
      { status: 'retry_after', reason: 't', retryAt: '2026-11-23T02:00:00.000Z' },
      NOW,
    );
    addCompany(db, 'c', 'https://c.example/');
    expect(drain(store, NOW)).toEqual(['c', 'b', 'a']);
    expect(store.nextDue(NOW)).toBeUndefined();
  });
});
