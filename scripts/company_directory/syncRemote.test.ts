import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { COMPANY_DIRECTORY_MIGRATION } from '../../server/data/companyDirectorySchema';

const SCRIPT = path.resolve(__dirname, 'sync_remote.cjs');
const TS = '2026-11-10T00:00:00Z';

function prodDb(): string {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'b628-sync-')), 'db.sqlite');
  const db = new DatabaseSync(file);
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
  const add = db.prepare(
    `INSERT INTO company_directory (company_key, company_name, source_type, created_at, updated_at, evidence)
     VALUES (?, ?, 'linkedin_guest', ?, ?, ?)`,
  );
  add.run('prod-import', 'Prod Import', TS, TS, '{"companyName":{"how":"hirehi.ru"}}');
  add.run('prod-bare', 'Prod Bare', TS, TS, null);
  add.run('acme', 'Old Acme', TS, TS, null);
  db.close();
  return file;
}

function sync(file: string, prune: boolean): Record<string, number> {
  const row = {
    companyKey: 'acme',
    companyName: 'Acme',
    sourceType: 'ats_direct',
    createdAt: TS,
    updatedAt: TS,
  };
  const out = execFileSync('node', [SCRIPT], {
    input: `${JSON.stringify(row)}\n`,
    env: { ...process.env, DB: file, DRY: '0', PRUNE: prune ? '1' : '0' },
  }).toString();
  return JSON.parse(out.trim().split('\n').pop() ?? '{}') as Record<string, number>;
}

function keys(file: string): string[] {
  const db = new DatabaseSync(file);
  const rows = db
    .prepare('SELECT company_key k, company_name n FROM company_directory ORDER BY 1')
    .all();
  db.close();
  return rows.map((r) => `${String(r.k)}:${String(r.n)}`);
}

describe('company directory sync to prod (B628)', () => {
  it('adds and updates git rows and keeps rows that exist only on prod', () => {
    const file = prodDb();
    expect(sync(file, false).deleted).toBe(0);
    expect(keys(file)).toEqual(['acme:Acme', 'prod-bare:Prod Bare', 'prod-import:Prod Import']);
  });
  it('--prune deletes only prod-only rows without evidence', () => {
    const file = prodDb();
    expect(sync(file, true).deleted).toBe(1);
    expect(keys(file)).toEqual(['acme:Acme', 'prod-import:Prod Import']);
  });
});
