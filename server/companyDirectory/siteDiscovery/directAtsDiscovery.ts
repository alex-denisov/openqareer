import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { publicApiCounter } from '../freehire/freehireRepoCheck';
import { nameKey } from '../freehire/freehireImport';
import type { PendingCompany } from './siteDiscovery';

export const DIRECT_ATS_CHECK_TABLE = `CREATE TABLE IF NOT EXISTS company_direct_ats_check (
  company_key TEXT NOT NULL, provider TEXT NOT NULL, board TEXT NOT NULL, source_url TEXT NOT NULL,
  origin TEXT NOT NULL, jobs INTEGER NOT NULL, checked_at INTEGER NOT NULL,
  PRIMARY KEY (company_key, provider, board)
) STRICT`;
export const DIRECT_ATS_FRESH_MS = 7 * 24 * 60 * 60_000;
const FILE = 'employer-boards.ndjson';

export interface DirectBoard {
  readonly provider: string;
  readonly board: string;
  readonly url: string;
  readonly origin: 'freehire' | 'career_ops';
}

interface CareerBoard extends DirectBoard {
  readonly name: string;
}

function host(value: string | null | undefined): string {
  if (!value) return '';
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const TENANT = /^[\w-][\w.-]{0,79}$/;
const RESERVED = /^(?:www|api|apply|app|embed|jobs|careers|oneclick-ui|support|widget|tt)$/i;
const PATH_HOST: Readonly<Record<string, string>> = {
  'boards.greenhouse.io': 'greenhouse',
  'job-boards.greenhouse.io': 'greenhouse',
  'jobs.lever.co': 'lever',
  'jobs.eu.lever.co': 'lever',
  'jobs.ashbyhq.com': 'ashby',
  'apply.workable.com': 'workable',
  'jobs.smartrecruiters.com': 'smartrecruiters',
  'careers.smartrecruiters.com': 'smartrecruiters',
};
const TENANT_HOSTS = [
  ['recruitee.com', 'recruitee'],
  ['breezy.hr', 'breezy'],
  ['pinpointhq.com', 'pinpoint'],
  ['jobs.personio.de', 'personio'],
  ['bamboohr.com', 'bamboohr'],
  ['teamtailor.com', 'teamtailor'],
] as const;

/** Resolve tenant and region from the URL, preserving case where the ATS uses it. */
export function directBoard(url: string, origin: DirectBoard['origin']): DirectBoard | undefined {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return undefined; }
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password) return undefined;
  const hostname = parsed.hostname;
  const parts = parsed.pathname.split('/').filter(Boolean);
  const workday = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/.exec(hostname);
  if (workday) {
    const site = /^[a-z]{2}-[a-z]{2}$/i.test(parts[0] ?? '') ? parts[1] : parts[0];
    if (site && TENANT.test(site) && !RESERVED.test(site))
      return { provider: 'workday', board: `${workday[1]}/${workday[2]}/${site}`, url, origin };
    return undefined;
  }
  const provider = Object.hasOwn(PATH_HOST, hostname) ? PATH_HOST[hostname] : undefined;
  if (provider) {
    const raw = provider === 'smartrecruiters' && parts[0] === 'oneclick-ui' && parts[1] === 'company' ? parts[2] : parts[0];
    if (!raw || !TENANT.test(raw) || RESERVED.test(raw)) return undefined;
    if (hostname === 'jobs.lever.co' && raw.startsWith('eu-')) return undefined;
    const board = hostname === 'jobs.eu.lever.co' ? `eu-${raw}` : raw;
    return { provider, board, url, origin };
  }
  for (const [suffix, provider] of TENANT_HOSTS) {
    if (!hostname.endsWith(`.${suffix}`)) continue;
    const board = hostname.slice(0, -suffix.length - 1);
    if (/^[a-z0-9-]+$/.test(board) && !RESERVED.test(board)) return { provider, board, url, origin };
  }
  return undefined;
}

function readCareerBoards(): ReadonlyMap<string, readonly CareerBoard[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = [
    join(here, 'data/careerOps', FILE),
    join(here, '../careerOps/data', FILE),
  ].find(existsSync);
  if (!path) throw new Error('career_ops_board_catalog_missing');
  const boards = new Map<string, CareerBoard[]>();
  for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as { name?: string; website?: string; careers_url?: string };
    const domain = host(row.website);
    const board = row.careers_url && directBoard(row.careers_url, 'career_ops');
    if (!domain || !board || !row.name) continue;
    const existing = boards.get(domain);
    const entry = { ...board, name: row.name };
    if (existing) existing.push(entry);
    else boards.set(domain, [entry]);
  }
  return boards;
}

type Counter = ReturnType<typeof publicApiCounter>;

export class DirectAtsDiscovery {
  constructor(
    private readonly database: DatabaseSync,
    private readonly count: Counter,
    private readonly career: ReadonlyMap<string, readonly CareerBoard[]> = readCareerBoards(),
  ) {
    database.exec(DIRECT_ATS_CHECK_TABLE);
  }

  private careerBoards(company: PendingCompany): readonly CareerBoard[] {
    const name = nameKey(company.companyName);
    return (this.career.get(host(company.websiteUrl)) ?? []).filter((candidate) => nameKey(candidate.name) === name);
  }

  prioritized(company: PendingCompany): boolean {
    return company.hasFreehireBoards === true || this.careerBoards(company).length > 0;
  }

  async probe(company: PendingCompany, now: Date): Promise<{ checked: number; live: number }> {
    const candidates = new Map<string, DirectBoard>();
    const add = (board: DirectBoard) => candidates.set(`${board.provider}:${board.board}`, board);
    if (company.hasFreehireBoards && company.freehireSlug) {
      const row = this.database.prepare('SELECT evidence FROM freehire_company_source_candidates WHERE slug = ?')
        .get(company.freehireSlug) as { evidence: string } | undefined;
      const card = row && JSON.parse(row.evidence) as { jobs?: { url?: string }[] };
      for (const { url } of card?.jobs ?? []) {
        const candidate = url && directBoard(url, 'freehire');
        if (candidate) add(candidate);
      }
    }
    for (const board of this.careerBoards(company)) add(board);
    if (candidates.size === 0) return { checked: 0, live: 0 };
    const save = this.database.prepare(`INSERT INTO company_direct_ats_check VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(company_key, provider, board) DO UPDATE SET
        source_url=excluded.source_url, origin=excluded.origin, jobs=excluded.jobs, checked_at=excluded.checked_at`);
    const known = this.database.prepare(`SELECT jobs FROM company_direct_ats_check
      WHERE company_key=? AND provider=? AND board=? AND checked_at > ?`);
    let checked = 0;
    let live = 0;
    for (const { provider, board, url, origin } of [...candidates.values()].slice(0, 6)) {
      const cached = known.get(company.companyKey, provider, board, now.getTime() - DIRECT_ATS_FRESH_MS) as
        { jobs: number } | undefined;
      if (cached) {
        if (cached.jobs > 0) live++;
        continue;
      }
      const jobs = await this.count(provider, board);
      save.run(company.companyKey, provider, board, url, origin, jobs, now.getTime());
      checked++;
      if (jobs > 0) live++;
    }
    return { checked, live };
  }
}
