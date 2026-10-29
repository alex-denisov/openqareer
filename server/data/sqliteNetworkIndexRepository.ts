import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { candidateCompanyKey } from '../domain/candidateCompanies';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';

/**
 * B561 slice 2: the shared index of people the platform members know on LinkedIn.
 * A person is keyed by the canonical profile address (whose slug often carries the
 * name); no name field is kept. An edge says which member has the person in the
 * 1st circle and holds that member's own reading of the company key and role, so
 * one member can never move another member's path (security review 29.10). Members
 * with LinkedIn connected feed it (owner 30.10: platform members are 1st circle to
 * each other); other candidates see the members, never these rows.
 */
export type NetworkSource = 'search' | 'connections';

export interface NetworkObservation {
  readonly profileUrl: string;
  readonly companyName: string;
  readonly roleTitle: string;
  readonly source: NetworkSource;
  readonly observedAt: string;
}

interface EdgeRow {
  company_key: string;
  source: string;
}

type RepositoryOptions = DatabaseSync | { databasePath: string };

/** An edge nobody confirmed for this long is dropped (DPO pass, 29.10). */
export const NETWORK_EDGE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const STALE_SWEEP_INTERVAL_MS = 60 * 60 * 1_000;

/** `https://www.linkedin.com/in/<slug>/` in lower case, or null for anything else. */
export function canonicalLinkedInProfile(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  if (host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) return null;
  const [section, slug] = parsed.pathname.split('/').filter(Boolean);
  if (section?.toLowerCase() !== 'in' || !slug) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    return null;
  }
  const normalized = decoded.trim().toLocaleLowerCase('und');
  if (!normalized || normalized.length > 200 || /[\s/?#]/u.test(normalized)) return null;
  return `https://www.linkedin.com/in/${encodeURIComponent(normalized)}/`;
}

export class SqliteNetworkIndexRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private lastStaleSweepAt = 0;

  constructor(options: RepositoryOptions) {
    if (options instanceof DatabaseSync) {
      this.database = options;
      this.ownsDatabase = false;
    } else {
      if (options.databasePath !== ':memory:') {
        mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
      }
      this.database = new DatabaseSync(options.databasePath);
      this.ownsDatabase = true;
      this.database.exec('PRAGMA journal_mode = WAL;');
      applySqliteBusyTimeout(this.database);
    }
    this.database.exec('PRAGMA foreign_keys = ON;');
    const hasCandidates =
      this.database
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidates'")
        .get() !== undefined;
    const memberReference = hasCandidates ? 'REFERENCES candidates(id) ON DELETE CASCADE' : '';
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS network_people (
        profile_url TEXT PRIMARY KEY,
        first_observed_at TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS network_edges (
        member_id TEXT NOT NULL ${memberReference},
        profile_url TEXT NOT NULL REFERENCES network_people(profile_url) ON DELETE CASCADE,
        company_key TEXT NOT NULL,
        role_title TEXT NOT NULL,
        source TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        PRIMARY KEY (member_id, profile_url)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_network_edges_profile ON network_edges(profile_url);
      CREATE INDEX IF NOT EXISTS idx_network_edges_company ON network_edges(company_key, member_id);
      CREATE INDEX IF NOT EXISTS idx_network_edges_observed ON network_edges(observed_at);
      -- Owner 30.10: no referral requests in the app; their tables from slice 3 go.
      DROP TABLE IF EXISTS network_referral_blocks;
      DROP TABLE IF EXISTS network_referral_requests;
    `);
  }

  /** Adds or refreshes the member's edges to the observed people. */
  recordObservations(memberId: string, observations: readonly NetworkObservation[]): void {
    this.transaction(() => {
      for (const observation of observations) this.recordOne(memberId, observation);
    });
  }

  /** The member's full connections list: edges to people not on it are dropped. */
  replaceMemberEdges(memberId: string, observations: readonly NetworkObservation[]): void {
    this.transaction(() => {
      this.database.prepare('DELETE FROM network_edges WHERE member_id = ?').run(memberId);
      for (const observation of observations) this.recordOne(memberId, observation);
      this.pruneOrphans();
    });
  }

  /** LinkedIn disconnected or account deleted: every edge goes, and people nobody else knows. */
  deleteMemberEdges(memberId: string): number {
    let removed = 0;
    this.transaction(() => {
      removed = Number(
        this.database.prepare('DELETE FROM network_edges WHERE member_id = ?').run(memberId)
          .changes,
      );
      this.pruneOrphans();
    });
    return removed;
  }

  /**
   * The other members who know someone at the company now — each member once, however
   * many people they know there. The candidate's own edges never count. A member found
   * without LinkedIn connected loses the edges a missed disconnect left behind.
   */
  membersWithPathsInto(
    companyKey: string,
    excludeMemberId: string,
    isActiveMember: (memberId: string) => boolean,
    now: Date = new Date(),
    limit = 1_000,
  ): string[] {
    if (!companyKey) return [];
    this.dropStaleEdges(now);
    const rows = this.database
      .prepare(
        `SELECT DISTINCT member_id FROM network_edges
          WHERE company_key = ? AND member_id <> ? AND observed_at >= ?
          ORDER BY member_id LIMIT ?`,
      )
      .all(
        companyKey,
        excludeMemberId,
        new Date(now.getTime() - NETWORK_EDGE_TTL_MS).toISOString(),
        limit,
      ) as unknown as Array<{ member_id: string }>;
    const members = rows.map((row) => row.member_id);
    const active = members.filter(isActiveMember);
    for (const memberId of members) {
      if (!active.includes(memberId)) this.deleteMemberEdges(memberId);
    }
    return active;
  }

  /** Distinct other members with a current edge into the company, counted in SQL. */
  memberCountInto(companyKey: string, excludeMemberId: string, now: Date = new Date()): number {
    if (!companyKey) return 0;
    const row = this.database
      .prepare(
        `SELECT COUNT(DISTINCT member_id) AS total FROM network_edges
          WHERE company_key = ? AND member_id <> ? AND observed_at >= ?`,
      )
      .get(
        companyKey,
        excludeMemberId,
        new Date(now.getTime() - NETWORK_EDGE_TTL_MS).toISOString(),
      ) as { total: number };
    return Number(row.total);
  }

  memberEdgeCount(memberId: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS total FROM network_edges WHERE member_id = ?')
      .get(memberId) as { total: number };
    return Number(row.total);
  }

  /** The member's own people at the company, to read their names from the member's contacts. */
  memberProfilesAt(memberId: string, companyKey: string): string[] {
    const rows = this.database
      .prepare(
        `SELECT profile_url FROM network_edges
          WHERE member_id = ? AND company_key = ? ORDER BY profile_url`,
      )
      .all(memberId, companyKey) as unknown as Array<{ profile_url: string }>;
    return rows.map((row) => row.profile_url);
  }

  personCount(): number {
    const row = this.database.prepare('SELECT COUNT(*) AS total FROM network_people').get() as {
      total: number;
    };
    return Number(row.total);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  private recordOne(memberId: string, observation: NetworkObservation): void {
    const profileUrl = canonicalLinkedInProfile(observation.profileUrl);
    if (!profileUrl) return;
    const companyName = observation.companyName.trim();
    const companyKey = companyName ? candidateCompanyKey(companyName) : '';
    // A contact with no known company adds no path, so it is not kept (minimisation).
    if (!companyKey) return;
    const roleTitle = observation.roleTitle.trim().slice(0, 160);
    this.database
      .prepare(
        `INSERT INTO network_people (profile_url, first_observed_at) VALUES (?, ?)
         ON CONFLICT (profile_url) DO NOTHING`,
      )
      .run(profileUrl, observation.observedAt);
    const existing = this.database
      .prepare('SELECT company_key, source FROM network_edges WHERE member_id = ? AND profile_url = ?')
      .get(memberId, profileUrl) as unknown as EdgeRow | undefined;
    // A company read by search outlives a headline.
    const keepsPlace =
      existing !== undefined && existing.source === 'search' && observation.source !== 'search';
    if (keepsPlace) return;
    this.database
      .prepare(
        `INSERT INTO network_edges (member_id, profile_url, company_key, role_title, source, observed_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (member_id, profile_url) DO UPDATE SET
           company_key = excluded.company_key, role_title = excluded.role_title,
           source = excluded.source, observed_at = excluded.observed_at`,
      )
      .run(memberId, profileUrl, companyKey, roleTitle, observation.source, observation.observedAt);
  }

  /** At most once an hour, so a circles read rarely writes. */
  private dropStaleEdges(now: Date): void {
    if (now.getTime() - this.lastStaleSweepAt < STALE_SWEEP_INTERVAL_MS) return;
    this.lastStaleSweepAt = now.getTime();
    const cutoff = new Date(now.getTime() - NETWORK_EDGE_TTL_MS).toISOString();
    this.transaction(() => {
      const removed = this.database
        .prepare('DELETE FROM network_edges WHERE observed_at < ?')
        .run(cutoff).changes;
      if (Number(removed) > 0) this.pruneOrphans();
    });
  }

  private pruneOrphans(): void {
    this.database
      .prepare(
        `DELETE FROM network_people
          WHERE NOT EXISTS (SELECT 1 FROM network_edges e WHERE e.profile_url = network_people.profile_url)`,
      )
      .run();
  }

  private transaction(work: () => void): void {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      work();
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
