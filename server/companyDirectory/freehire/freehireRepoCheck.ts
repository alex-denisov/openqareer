/**
 * B644: boards imported from the freehire repo are checked one by one through the
 * provider's public API (no model). A board with jobs becomes the company's ATS
 * pair in `company_directory`, which is what puts it into polling; the daily cap
 * keeps the polled set growing in portions.
 */
import type { DatabaseSync } from 'node:sqlite';
import { boardJobs, PROVIDER_NAMES, type DiscoveredProvider } from '../siteDiscovery/atsBoards';

const CHECK_TABLE = `CREATE TABLE IF NOT EXISTS freehire_repo_check (
  placement_id TEXT PRIMARY KEY,
  jobs INTEGER NOT NULL,
  checked_at INTEGER NOT NULL
) STRICT`;

export type JobsCounter = (provider: string, slug: string) => Promise<number>;

const EXTRA_PROVIDERS = ['workday', 'bamboohr'] as const;
const CHECKED_PROVIDERS: readonly string[] = [...PROVIDER_NAMES, ...EXTRA_PROVIDERS];
const WORKDAY_SLUG = /^([a-z0-9-]+)\/(wd\d+)\/([A-Za-z0-9_-]+)$/i;

async function jsonOf(response: Response): Promise<Record<string, unknown> | undefined> {
  if (response.status !== 200) return undefined;
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** Workday CXS search: `total` of the board; -1 when it does not answer. */
export async function workdayJobs(slug: string, fetchImpl: typeof fetch): Promise<number> {
  const match = WORKDAY_SLUG.exec(slug);
  if (!match) return -1;
  const [, tenant, wd, site] = match;
  try {
    const body = await jsonOf(
      await fetchImpl(`https://${tenant}.${wd}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
        signal: AbortSignal.timeout(12_000),
      }),
    );
    return typeof body?.total === 'number' ? body.total : -1;
  } catch {
    return -1;
  }
}

/** BambooHR careers list: number of `result` rows; -1 when it does not answer. */
export async function bamboohrJobs(slug: string, fetchImpl: typeof fetch): Promise<number> {
  if (!/^[\w-]{2,80}$/.test(slug)) return -1;
  try {
    const body = await jsonOf(
      await fetchImpl(`https://${slug}.bamboohr.com/careers/list`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(12_000) }),
    );
    return Array.isArray(body?.result) ? body.result.length : -1;
  } catch {
    return -1;
  }
}

export function publicApiCounter(fetchImpl: typeof fetch): JobsCounter {
  return (provider, slug) => {
    if (provider === 'workday') return workdayJobs(slug, fetchImpl);
    if (provider === 'bamboohr') return bamboohrJobs(slug, fetchImpl);
    return boardJobs({ provider: provider as DiscoveredProvider, slug }, fetchImpl);
  };
}

interface Pending {
  placement_id: string;
  company_key: string;
  provider: string;
  slug: string;
}

export function confirmedToday(database: DatabaseSync, nowMs: number): number {
  database.exec(CHECK_TABLE);
  const dayStart = nowMs - (nowMs % 86_400_000);
  const row = database.prepare('SELECT count(*) AS n FROM freehire_repo_check WHERE jobs > 0 AND checked_at >= ?').get(dayStart) as { n: number };
  return row.n;
}

function pending(database: DatabaseSync, limit: number): readonly Pending[] {
  const providers = CHECKED_PROVIDERS.map((p) => `'${p}'`).join(',');
  return database
    .prepare(
      `SELECT p.placement_id, p.company_key, p.provider, p.slug FROM company_placement p
        WHERE p.discovered_by = 'freehire' AND p.type = 'ats' AND p.company_key IS NOT NULL
          AND p.provider IN (${providers})
          AND NOT EXISTS (SELECT 1 FROM freehire_repo_check c WHERE c.placement_id = p.placement_id)
        ORDER BY p.placement_id LIMIT ?`,
    )
    .all(limit) as unknown as Pending[];
}

export interface CheckTotals {
  readonly checked: number;
  readonly withJobs: number;
  readonly dead: number;
  readonly promoted: number;
}

/** Checks up to `limit` boards; stops early once today's confirmations reach `dailyCap`. */
export async function checkRepoBoards(
  database: DatabaseSync,
  count: JobsCounter,
  limit: number,
  dailyCap: number,
  now: () => number = Date.now,
): Promise<CheckTotals> {
  database.exec(CHECK_TABLE);
  if (confirmedToday(database, now()) >= dailyCap) return { checked: 0, withJobs: 0, dead: 0, promoted: 0 };
  const save = database.prepare('INSERT OR REPLACE INTO freehire_repo_check (placement_id, jobs, checked_at) VALUES (?, ?, ?)');
  const promote = database.prepare(
    `UPDATE company_directory SET ats_provider = ?, ats_slug = ?, source_type = 'ats_direct', updated_at = ?,
       evidence = json_patch(COALESCE(evidence, '{}'), ?)
     WHERE company_key = ? AND ats_provider IS NULL AND status = 'active'`,
  );
  let withJobs = 0;
  let dead = 0;
  let promoted = 0;
  const rows = pending(database, limit);
  for (const row of rows) {
    const jobs = await count(row.provider, row.slug);
    const at = now();
    save.run(row.placement_id, jobs, at);
    if (jobs < 0) dead += 1;
    if (jobs <= 0) continue;
    withJobs += 1;
    const day = new Date(at).toISOString().slice(0, 10);
    const evidence = JSON.stringify({ ats: { value: `${row.provider}:${row.slug}`, how: `freehire repo board; public API listed ${jobs} jobs on ${day}`, confirmed: true } });
    promoted += Number(promote.run(row.provider, row.slug, new Date(at).toISOString(), evidence, row.company_key).changes);
  }
  return { checked: rows.length, withJobs, dead, promoted };
}
