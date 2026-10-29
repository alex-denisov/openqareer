import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';

/**
 * B561 slice 3: «Попросить рекомендацию». Candidate B asks every consenting member
 * with a path into a company; each member answers on their own. The row keeps only
 * ids, the company and the vacancy title — names are read from the profiles when
 * shown, and only after the member accepts.
 */
export type ReferralRequestStatus = 'pending' | 'accepted' | 'declined' | 'withdrawn';

export interface ReferralRequestCompany {
  readonly companyKey: string;
  readonly companyName: string;
  readonly vacancyTitle: string;
}

export interface ReferralRequest extends ReferralRequestCompany {
  readonly id: string;
  readonly requesterId: string;
  readonly memberId: string;
  readonly status: ReferralRequestStatus;
  readonly createdAt: string;
  readonly answeredAt: string | null;
}

interface ReferralRequestRow {
  id: string;
  requester_id: string;
  member_id: string;
  company_key: string;
  company_name: string;
  vacancy_title: string;
  status: ReferralRequestStatus;
  created_at: string;
  answered_at: string | null;
}

const MAX_INCOMING = 50;
/** Spam caps (security review 30.10): the signed-in cabinet has no HTTP rate limits. */
export const MAX_MEMBERS_PER_ASK = 10;
export const MAX_OPEN_PER_REQUESTER = 30;
export const MAX_PENDING_PER_MEMBER = 20;
const ANSWERED_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;
const BLOCK_RETENTION_MS = 365 * 24 * 60 * 60 * 1_000;

type RepositoryOptions = DatabaseSync | { databasePath: string };

export class SqliteReferralRequestRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;

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
    const reference = hasCandidates ? 'REFERENCES candidates(id) ON DELETE CASCADE' : '';
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS network_referral_requests (
        id TEXT PRIMARY KEY,
        requester_id TEXT NOT NULL ${reference},
        member_id TEXT NOT NULL ${reference},
        company_key TEXT NOT NULL,
        company_name TEXT NOT NULL,
        vacancy_title TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'withdrawn')),
        created_at TEXT NOT NULL,
        answered_at TEXT,
        UNIQUE (requester_id, member_id, company_key)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS idx_referral_requests_member
        ON network_referral_requests(member_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_referral_requests_requester
        ON network_referral_requests(requester_id, status);
      CREATE TABLE IF NOT EXISTS network_referral_blocks (
        member_id TEXT NOT NULL ${reference},
        requester_id TEXT NOT NULL ${reference},
        created_at TEXT NOT NULL,
        PRIMARY KEY (member_id, requester_id)
      ) STRICT;
    `);
  }

  /**
   * One request per member and company; only a withdrawn one may be sent again.
   * At most ten members per ask, chosen at random, none who declined this asker,
   * none with a full queue, and the asker stops at 30 open requests.
   */
  request(
    requesterId: string,
    memberIds: readonly string[],
    company: ReferralRequestCompany,
    now: string,
  ): number {
    this.purgeExpired(now);
    const insert = this.database.prepare(
      `INSERT INTO network_referral_requests
         (id, requester_id, member_id, company_key, company_name, vacancy_title, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)
       ON CONFLICT (requester_id, member_id, company_key) DO UPDATE SET
         status = 'pending', created_at = excluded.created_at, answered_at = NULL,
         vacancy_title = excluded.vacancy_title
       WHERE network_referral_requests.status = 'withdrawn'`,
    );
    let room = Math.max(0, MAX_OPEN_PER_REQUESTER - this.openRequestCount(requesterId));
    let created = 0;
    for (const memberId of shuffled(memberIds)) {
      if (created >= MAX_MEMBERS_PER_ASK || room <= 0) break;
      if (memberId === requesterId || !this.canAsk(requesterId, memberId)) continue;
      const added = Number(
        insert.run(
          randomUUID(),
          requesterId,
          memberId,
          company.companyKey,
          company.companyName.slice(0, 180),
          company.vacancyTitle.slice(0, 200),
          now,
        ).changes,
      );
      created += added;
      room -= added;
    }
    return created;
  }

  openRequestCount(requesterId: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS total FROM network_referral_requests
          WHERE requester_id = ? AND status = 'pending'`,
      )
      .get(requesterId) as { total: number };
    return Number(row.total);
  }

  /** Declined, answered and withdrawn requests go after 90 days; blocks after a year. */
  purgeExpired(now: string): void {
    const at = Date.parse(now);
    this.database
      .prepare(
        `DELETE FROM network_referral_requests
          WHERE status IN ('declined', 'withdrawn') AND answered_at < ?`,
      )
      .run(new Date(at - ANSWERED_RETENTION_MS).toISOString());
    this.database
      .prepare('DELETE FROM network_referral_blocks WHERE created_at < ?')
      .run(new Date(at - BLOCK_RETENTION_MS).toISOString());
  }

  private canAsk(requesterId: string, memberId: string): boolean {
    const blocked = this.database
      .prepare('SELECT 1 FROM network_referral_blocks WHERE member_id = ? AND requester_id = ?')
      .get(memberId, requesterId);
    if (blocked) return false;
    const queue = this.database
      .prepare(
        `SELECT COUNT(*) AS total FROM network_referral_requests
          WHERE member_id = ? AND status = 'pending'`,
      )
      .get(memberId) as { total: number };
    return Number(queue.total) < MAX_PENDING_PER_MEMBER;
  }

  /** What the member was asked and agreed to; declined and withdrawn requests drop out. */
  listIncoming(memberId: string): ReferralRequest[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM network_referral_requests
          WHERE member_id = ? AND status IN ('pending', 'accepted')
          ORDER BY created_at DESC LIMIT ?`,
      )
      .all(memberId, MAX_INCOMING) as unknown as ReferralRequestRow[];
    return rows.map(toRequest);
  }

  outgoingFor(requesterId: string, companyKey: string): ReferralRequest[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM network_referral_requests
          WHERE requester_id = ? AND company_key = ? ORDER BY created_at, id`,
      )
      .all(requesterId, companyKey) as unknown as ReferralRequestRow[];
    return rows.map(toRequest);
  }

  /** Only the asked member answers, and only a pending request. */
  answer(
    requestId: string,
    memberId: string,
    decision: 'accepted' | 'declined',
    now: string,
  ): boolean {
    const result = this.database
      .prepare(
        `UPDATE network_referral_requests SET status = ?, answered_at = ?
          WHERE id = ? AND member_id = ? AND status = 'pending'`,
      )
      .run(decision, now, requestId, memberId);
    const answered = Number(result.changes) > 0;
    if (answered && decision === 'declined') this.blockRequesterOf(requestId, memberId, now);
    return answered;
  }

  /** A decline stops the same asker from asking this member again, for any company. */
  private blockRequesterOf(requestId: string, memberId: string, now: string): void {
    this.database
      .prepare(
        `INSERT INTO network_referral_blocks (member_id, requester_id, created_at)
         SELECT member_id, requester_id, ? FROM network_referral_requests WHERE id = ? AND member_id = ?
         ON CONFLICT (member_id, requester_id) DO UPDATE SET created_at = excluded.created_at`,
      )
      .run(now, requestId, memberId);
    // The asker's other open requests to this member close with the same answer.
    this.database
      .prepare(
        `UPDATE network_referral_requests SET status = 'declined', answered_at = ?
          WHERE member_id = ? AND status = 'pending'
            AND requester_id = (SELECT requester_id FROM network_referral_requests WHERE id = ?)`,
      )
      .run(now, memberId, requestId);
  }

  /** Consent revoked: nothing the member was asked or agreed to stays visible. */
  withdrawForMember(memberId: string, now: string): number {
    const result = this.database
      .prepare(
        `UPDATE network_referral_requests SET status = 'withdrawn', answered_at = ?
          WHERE member_id = ? AND status IN ('pending', 'accepted')`,
      )
      .run(now, memberId);
    return Number(result.changes);
  }

  deleteForCandidate(candidateId: string): number {
    const result = this.database
      .prepare('DELETE FROM network_referral_requests WHERE requester_id = ? OR member_id = ?')
      .run(candidateId, candidateId);
    this.database
      .prepare('DELETE FROM network_referral_blocks WHERE requester_id = ? OR member_id = ?')
      .run(candidateId, candidateId);
    return Number(result.changes);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }
}

function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[other]] = [copy[other]!, copy[index]!];
  }
  return copy;
}

function toRequest(row: ReferralRequestRow): ReferralRequest {
  return {
    id: row.id,
    requesterId: row.requester_id,
    memberId: row.member_id,
    companyKey: row.company_key,
    companyName: row.company_name,
    vacancyTitle: row.vacancy_title,
    status: row.status,
    createdAt: row.created_at,
    answeredAt: row.answered_at,
  };
}
