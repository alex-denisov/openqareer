/**
 * B644: companies and their ATS boards from the board catalog of
 * github.com/strelov1/freehire (MIT, © 2026 freehire contributors) — the
 * `sources/*.yml` files as of 2026-09-03, the last commit before the catalog moved
 * into their database (#2406). Aggregators and job sites are left out; Workday
 * boards are in our `tenant/wdN/site` form. File: ./data/*.tsv.gz (dist/data/freehire in the release),
 * one `provider<TAB>board<TAB>company` per line.
 *
 * No network here: a board lands in `company_placement` unconfirmed, and the
 * company gets an ATS pair only after `freehireRepoCheck` sees jobs in the
 * provider's public API.
 */
import type { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { recordCompanyPlacements } from '../placement/placementWriter';
import { isAggregator, loadDirectoryIndex, nameKey, type DirectoryIndex } from './freehireImport';

export const REPO_FILE = 'freehire-boards-2026-09-03.tsv.gz';
export const REPO_EVIDENCE_HOW = 'github.com/strelov1/freehire sources/*.yml, commit 2b781bf5^ (2026-09-03)';

export interface RepoBoard {
  readonly provider: string;
  readonly board: string;
  readonly company: string;
}

export function parseRepoBoards(text: string): readonly RepoBoard[] {
  const rows: RepoBoard[] = [];
  for (const line of text.split('\n')) {
    const [provider, board, company] = line.split('\t');
    if (provider && board && company) rows.push({ provider, board, company: company.trim() });
  }
  return rows;
}

export function readRepoFile(): readonly RepoBoard[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(here, 'data/freehire', REPO_FILE), join(here, 'data', REPO_FILE), join(process.cwd(), 'server/companyDirectory/freehire/data', REPO_FILE)];
  const path = candidates.find((p) => existsSync(p));
  if (!path) throw new Error(`freehire_repo_file_missing:${REPO_FILE}`);
  return parseRepoBoards(gunzipSync(readFileSync(path)).toString('utf8'));
}

/** «103644278», «12jlkfsk»-like ids are kept only when they look like a name. */
export function usableName(name: string): boolean {
  return name.length >= 2 && name.length <= 160 && /\p{L}/u.test(name) && !/^https?:|\.(com|net|org|io)$/i.test(name) && !isAggregator(name);
}

/** Directory key for a new company: name key, made unique. */
function newKey(index: DirectoryIndex, name: string, board: string): string {
  const base = nameKey(name) || board.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return index.byKey.has(base) ? `${base}-fh` : base;
}

export interface RepoImportTotals {
  readonly read: number;
  readonly added: number;
  readonly matched: number;
  readonly skipped: number;
}

/** Imports rows[offset, offset+limit) in one transaction. */
export function importRepoChunk(
  database: DatabaseSync,
  rows: readonly RepoBoard[],
  offset: number,
  limit: number,
  now: Date,
  index: DirectoryIndex = loadDirectoryIndex(database),
): RepoImportTotals {
  const stamp = now.toISOString();
  const insert = database.prepare(
    `INSERT INTO company_directory (company_key, company_name, source_type, status, created_at, updated_at, evidence)
     VALUES (?, ?, 'ats_direct', 'active', ?, ?, ?) ON CONFLICT(company_key) DO NOTHING`,
  );
  const evidence = JSON.stringify({ freehire: { value: 'repo', how: REPO_EVIDENCE_HOW } });
  let added = 0;
  let matched = 0;
  let skipped = 0;
  const slice = rows.slice(offset, offset + limit);
  database.exec('BEGIN');
  try {
    for (const row of slice) {
      if (!usableName(row.company) || isAggregator(row.board)) {
        skipped += 1;
        continue;
      }
      const board = row.board.toLowerCase();
      const existing = index.byBoard.get(`${row.provider}:${board}`) ?? index.byName.get(nameKey(row.company));
      let key = existing;
      if (!key) {
        key = newKey(index, row.company, board);
        insert.run(key, row.company, stamp, stamp, evidence);
        index.byKey.set(key, key);
        index.byName.set(nameKey(row.company), key);
        added += 1;
      } else matched += 1;
      index.byBoard.set(`${row.provider}:${board}`, key);
      recordCompanyPlacements(database, key, { boards: [{ provider: row.provider, slug: board }], discoveredBy: 'freehire' }, now.getTime());
    }
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { read: slice.length, added, matched, skipped };
}
