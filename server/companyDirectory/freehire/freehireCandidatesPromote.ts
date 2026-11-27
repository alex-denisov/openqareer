import type { DatabaseSync } from 'node:sqlite';
import { PLACEMENT_TABLES } from '../placement/placementSchema';
import { isPublicHost } from '../siteDiscovery/siteDiscovery';
import { boardFromJobUrl, cleanWebsite, nameKey, type FoundBoard } from './freehireImport';
import type { FreehireCompanyCard } from './freehireClient';

export interface PromoteCandidatesOptions {
  readonly chunkSize?: number;
  readonly nowMs?: number;
}

export interface PromoteCandidatesResult {
  readonly scanned: number;
  readonly promoted: number;
  readonly skipped: number;
  readonly websitesFilled: number;
  readonly linkedinsFilled: number;
  readonly careersFilled: number;
  readonly boardsPromoted: number;
}

interface CandidateEvidence {
  readonly slug?: string;
  readonly name?: string;
  readonly website?: string | null;
  readonly careers?: string | null;
  readonly careersUrl?: string | null;
  readonly linkedin?: string | null;
  readonly linkedinUrl?: string | null;
  readonly linkedinOrgId?: string | number | null;
  readonly boards?: readonly { readonly provider?: unknown; readonly slug?: unknown }[];
  readonly jobs?: readonly { readonly url?: string }[];
}

interface DirectoryRow {
  readonly company_key: string;
  readonly website_url: string | null;
  readonly careers_url: string | null;
  readonly linkedin_url: string | null;
  readonly linkedin_org_id: string | null;
  readonly ats_provider: string | null;
  readonly ats_slug: string | null;
  readonly source_type: string;
  readonly evidence: string | null;
}

const DEFAULT_CHUNK_SIZE = 500;
const BLOCKED_CAREERS_HOSTS =
  /(^|\.)(linkedin\.com|facebook\.com|instagram\.com|twitter\.com|x\.com|youtube\.com|t\.me|freehire\.me|indeed\.com|glassdoor\.com|hh\.ru|wellfound\.com|crunchbase\.com|google\.com|wikipedia\.org)$/i;

function parseJsonObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function cleanCareersUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (!isPublicHost(url) || BLOCKED_CAREERS_HOSTS.test(url.hostname)) return null;
    if (url.protocol === 'http:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function cleanLinkedinUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!/^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/company\/[^/?#]+/i.test(trimmed)) return null;
  if (/keywords=/i.test(trimmed)) return null;
  return trimmed;
}

function cleanOrgId(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isInteger(raw) && raw > 0) return String(raw);
  if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) return raw.trim();
  return null;
}

function extractFirstBoard(evidence: CandidateEvidence): FoundBoard | null {
  if (Array.isArray(evidence.boards)) {
    for (const b of evidence.boards) {
      const provider = typeof b?.provider === 'string' ? b.provider.trim().toLowerCase() : '';
      const slug = typeof b?.slug === 'string' ? b.slug.trim() : '';
      if (!provider || !slug) continue;
      if (provider === 'join' && !/^\d+$/.test(slug)) continue;
      return { provider, slug: slug.toLowerCase() };
    }
  }
  if (Array.isArray(evidence.jobs) && evidence.jobs.length > 0) {
    const card: FreehireCompanyCard = {
      slug: evidence.slug ?? '',
      name: evidence.name ?? '',
      website: evidence.website ?? null,
      jobs: evidence.jobs.map((j) => ({ url: typeof j?.url === 'string' ? j.url : '', source: 'freehire' })),
    };
    for (const b of card.jobs) {
      const parsed = boardFromJobUrl(b.url);
      if (parsed) return parsed;
    }
  }
  return null;
}

function tableExists(db: DatabaseSync, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function isDroppedCareersUrl(evidenceJson: Record<string, unknown> | null, url: string): boolean {
  const dropped = evidenceJson?.careersUrlDropped as { value?: unknown } | undefined;
  if (!dropped) return false;
  if (typeof dropped.value === 'string' && dropped.value === url) return true;
  return Boolean(dropped.value);
}

interface CandidatePatch {
  readonly websiteUrl: string | null;
  readonly careersUrl: string | null;
  readonly linkedinUrl: string | null;
  readonly linkedinOrgId: string | null;
  readonly board: FoundBoard | null;
}

function buildPatch(existing: DirectoryRow, ev: CandidateEvidence): CandidatePatch {
  const existingEv = parseJsonObject(existing.evidence);
  const websiteUrl = !existing.website_url ? cleanWebsite(typeof ev.website === 'string' ? ev.website : null) : null;
  const candidateCareers = cleanCareersUrl(ev.careers ?? ev.careersUrl);
  const careersUrl =
    !existing.careers_url && candidateCareers && !isDroppedCareersUrl(existingEv, candidateCareers)
      ? candidateCareers
      : null;
  const linkedinUrl = !existing.linkedin_url ? cleanLinkedinUrl(ev.linkedinUrl ?? ev.linkedin) : null;
  const linkedinOrgId = !existing.linkedin_org_id ? cleanOrgId(ev.linkedinOrgId) : null;
  const board = !existing.ats_provider ? extractFirstBoard(ev) : null;
  return { websiteUrl, careersUrl, linkedinUrl, linkedinOrgId, board };
}

function writePlacementForBoard(
  db: DatabaseSync,
  companyKey: string,
  board: FoundBoard,
  nowMs: number,
): void {
  const placementId = `ats:${board.provider}:${board.slug}`;
  const sourceId = `ats-${board.provider}-${board.slug}`;
  db.prepare(
    `INSERT OR IGNORE INTO company_placement (
       placement_id, company_key, type, provider, slug, url, priority, source_id, discovered_by, updated_at
     ) VALUES (?, ?, 'ats', ?, ?, NULL, 1, ?, 'freehire_promote', ?)`,
  ).run(placementId, companyKey, board.provider, board.slug, sourceId, nowMs);
}

function applyDirectoryAndPlacementPatch(
  db: DatabaseSync,
  companyKey: string,
  existing: DirectoryRow,
  patch: CandidatePatch,
  nowMs: number,
  isoNow: string,
): { changed: boolean; counts: { w: number; l: number; c: number; b: number } } {
  const hasDirChange = Boolean(
    patch.websiteUrl || patch.careersUrl || patch.linkedinUrl || patch.linkedinOrgId || patch.board,
  );
  if (!hasDirChange) return { changed: false, counts: { w: 0, l: 0, c: 0, b: 0 } };

  const evPatch: Record<string, unknown> = patch.careersUrl
    ? { careersUrlSetAt: isoNow, careersUrl: { value: patch.careersUrl, how: 'freehire_candidate_promote' } }
    : {};
  const mergedEvidence = Object.keys(evPatch).length
    ? JSON.stringify({ ...(parseJsonObject(existing.evidence) ?? {}), ...evPatch })
    : existing.evidence;
  const nextSourceType = patch.board ? 'ats_direct' : existing.source_type;

  db.prepare(
    `UPDATE company_directory SET website_url = COALESCE(website_url, ?), careers_url = COALESCE(careers_url, ?),
       linkedin_url = COALESCE(linkedin_url, ?), linkedin_org_id = COALESCE(linkedin_org_id, ?),
       ats_provider = COALESCE(ats_provider, ?), ats_slug = COALESCE(ats_slug, ?),
       source_type = ?, evidence = ?, updated_at = ? WHERE company_key = ?`,
  ).run(
    patch.websiteUrl,
    patch.careersUrl,
    patch.linkedinUrl,
    patch.linkedinOrgId,
    patch.board?.provider ?? null,
    patch.board?.slug ?? null,
    nextSourceType,
    mergedEvidence,
    isoNow,
    companyKey,
  );
  if (patch.board) writePlacementForBoard(db, companyKey, patch.board, nowMs);

  return {
    changed: true,
    counts: {
      w: patch.websiteUrl ? 1 : 0,
      l: patch.linkedinUrl || patch.linkedinOrgId ? 1 : 0,
      c: patch.careersUrl ? 1 : 0,
      b: patch.board ? 1 : 0,
    },
  };
}

interface MutablePromoteTotals {
  scanned: number;
  promoted: number;
  skipped: number;
  websitesFilled: number;
  linkedinsFilled: number;
  careersFilled: number;
  boardsPromoted: number;
}

function processCandidateBatch(
  db: DatabaseSync,
  page: readonly { slug: string; evidence: string }[],
  findDirStmt: ReturnType<DatabaseSync['prepare']>,
  totals: MutablePromoteTotals,
  nowMs: number,
  isoNow: string,
): string {
  let cursor = '';
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of page) {
      totals.scanned += 1;
      cursor = row.slug;
      const ev = parseJsonObject(row.evidence) as CandidateEvidence | null;
      if (!ev) {
        totals.skipped += 1;
        continue;
      }
      const dirRow =
        (findDirStmt.get(row.slug) as DirectoryRow | undefined) ??
        (typeof ev.name === 'string' ? (findDirStmt.get(nameKey(ev.name)) as DirectoryRow | undefined) : undefined);
      if (!dirRow) continue;
      const applied = applyDirectoryAndPlacementPatch(db, dirRow.company_key, dirRow, buildPatch(dirRow, ev), nowMs, isoNow);
      if (applied.changed) {
        totals.promoted += 1;
        totals.websitesFilled += applied.counts.w;
        totals.linkedinsFilled += applied.counts.l;
        totals.careersFilled += applied.counts.c;
        totals.boardsPromoted += applied.counts.b;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return cursor;
}

/**
 * Phase 2 F7: Потоковый перенос подтверждённых сайтов, LinkedIn и ATS-досок
 * из `freehire_company_source_candidates` в `company_directory` и `company_placement`
 * с курсором по ключу `slug` и без загрузки всей таблицы в кучу.
 */
export function promoteFreehireCandidates(
  db: DatabaseSync,
  options: PromoteCandidatesOptions = {},
): PromoteCandidatesResult {
  const backfill = new FreehireCandidatesPromoteBackfill(db, options);
  const totals: MutablePromoteTotals = {
    scanned: 0,
    promoted: 0,
    skipped: 0,
    websitesFilled: 0,
    linkedinsFilled: 0,
    careersFilled: 0,
    boardsPromoted: 0,
  };
  while (true) {
    const step = backfill.step();
    totals.scanned += step.scanned;
    totals.promoted += step.promoted;
    totals.skipped += step.skipped;
    totals.websitesFilled += step.websitesFilled;
    totals.linkedinsFilled += step.linkedinsFilled;
    totals.careersFilled += step.careersFilled;
    totals.boardsPromoted += step.boardsPromoted;
    if (step.done) break;
  }
  return totals;
}

export interface FreehireCandidatesPromoteStepReport extends PromoteCandidatesResult {
  readonly done: boolean;
  readonly ms: number;
}

export class FreehireCandidatesPromoteBackfill {
  private readonly chunkSize: number;
  private readonly nowMsOpt?: number;
  private readonly findDirStmt?: ReturnType<DatabaseSync['prepare']>;
  private readonly readPageStmt?: ReturnType<DatabaseSync['prepare']>;
  private readonly ready: boolean;
  private cursor = '';

  constructor(
    private readonly db: DatabaseSync,
    options: PromoteCandidatesOptions = {},
  ) {
    this.chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_CHUNK_SIZE);
    this.nowMsOpt = options.nowMs;
    this.ready =
      tableExists(db, 'freehire_company_source_candidates') && tableExists(db, 'company_directory');
    if (this.ready) {
      db.exec(PLACEMENT_TABLES);
      this.readPageStmt = db.prepare(
        `SELECT slug, evidence FROM freehire_company_source_candidates WHERE slug > ? ORDER BY slug LIMIT ?`,
      );
      this.findDirStmt = db.prepare(
        `SELECT company_key, website_url, careers_url, linkedin_url, linkedin_org_id,
                ats_provider, ats_slug, source_type, evidence
           FROM company_directory WHERE company_key = ?`,
      );
    }
  }

  step(): FreehireCandidatesPromoteStepReport {
    const startedAt = Date.now();
    const totals: MutablePromoteTotals = {
      scanned: 0,
      promoted: 0,
      skipped: 0,
      websitesFilled: 0,
      linkedinsFilled: 0,
      careersFilled: 0,
      boardsPromoted: 0,
    };
    if (!this.ready || !this.readPageStmt || !this.findDirStmt) {
      return { ...totals, done: true, ms: 0 };
    }
    const page = this.readPageStmt.all(this.cursor, this.chunkSize) as unknown as {
      slug: string;
      evidence: string;
    }[];
    if (page.length === 0) {
      this.cursor = '';
      return { ...totals, done: true, ms: Date.now() - startedAt };
    }
    const nowMs = this.nowMsOpt ?? startedAt;
    const isoNow = new Date(nowMs).toISOString();
    this.cursor = processCandidateBatch(this.db, page, this.findDirStmt, totals, nowMs, isoNow);
    const done = page.length < this.chunkSize;
    if (done) this.cursor = '';
    return { ...totals, done, ms: Date.now() - startedAt };
  }
}

export const FREEHIRE_PROMOTE_TICK_BUDGET_MS = 300;
export const FREEHIRE_PROMOTE_PASS_PAUSE_MS = 6 * 60 * 60_000;

/**
 * Фоновый тикер переноса подтверждённых сайтов/LinkedIn/ATS из `freehire_company_source_candidates`
 * в `company_directory` и `company_placement` порциями с бюджетом 300 мс на тик и паузой 6 ч между проходами.
 */
export class FreehireCandidatesPromoteTicker {
  private nextPassAt = 0;
  private totals: MutablePromoteTotals = {
    scanned: 0,
    promoted: 0,
    skipped: 0,
    websitesFilled: 0,
    linkedinsFilled: 0,
    careersFilled: 0,
    boardsPromoted: 0,
  };

  constructor(
    private readonly backfill: Pick<FreehireCandidatesPromoteBackfill, 'step'>,
    private readonly now: () => number = Date.now,
  ) {}

  tick(): FreehireCandidatesPromoteStepReport | undefined {
    const startedAt = this.now();
    if (startedAt < this.nextPassAt) return undefined;
    while (this.now() - startedAt < FREEHIRE_PROMOTE_TICK_BUDGET_MS) {
      const report = this.backfill.step();
      this.totals.scanned += report.scanned;
      this.totals.promoted += report.promoted;
      this.totals.skipped += report.skipped;
      this.totals.websitesFilled += report.websitesFilled;
      this.totals.linkedinsFilled += report.linkedinsFilled;
      this.totals.careersFilled += report.careersFilled;
      this.totals.boardsPromoted += report.boardsPromoted;
      if (report.done) {
        this.nextPassAt = this.now() + FREEHIRE_PROMOTE_PASS_PAUSE_MS;
        const doneReport: FreehireCandidatesPromoteStepReport = {
          ...this.totals,
          done: true,
          ms: this.now() - startedAt,
        };
        this.totals = {
          scanned: 0,
          promoted: 0,
          skipped: 0,
          websitesFilled: 0,
          linkedinsFilled: 0,
          careersFilled: 0,
          boardsPromoted: 0,
        };
        return doneReport;
      }
    }
    return undefined;
  }
}
