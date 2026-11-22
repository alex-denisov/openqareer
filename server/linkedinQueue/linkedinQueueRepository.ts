import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_LINKEDIN_POSTS_PER_WEEK, DEFAULT_LINKEDIN_RHYTHM_DAYS, DEFAULT_LINKEDIN_RHYTHM_TIME,
  LINKEDIN_POST_OPEN_URL, LINKEDIN_QUEUE_PREVIEW_MAX,
  type LinkedinQueueItem, type LinkedinQueuePage, type LinkedinQueueState, type LinkedinRhythm, type LinkedinRhythmDay,
} from '../../shared/b640LinkedinQueue';
import { LINKEDIN_QUEUE_TABLES } from '../data/linkedinQueueSchema';
import { isLinkedinUrl } from './linkedinUrl';
import { nextFreeSlot, weekKeyOfInstant } from './rhythmSlots';

interface QueueRow {
  id: string; draft_id: string; kind: 'post' | 'comment'; scheduled_at: string; state: string;
  updated_at: string; reminded_at: string | null; text: string; target_post_url: string | null;
}

const SELECT = `SELECT q.id, q.draft_id, q.kind, q.scheduled_at, q.state, q.updated_at, q.reminded_at, d.text, d.target_post_url
  FROM candidate_linkedin_queue q JOIN candidate_drafts d ON d.id = q.draft_id AND d.candidate_id = q.candidate_id`;

export type EnqueueResult =
  | { readonly ok: true; readonly item: LinkedinQueueItem }
  | { readonly ok: false; readonly error: 'not_found' | 'not_approved' | 'already_queued' | 'no_slot' };
export type ChangeResult =
  | { readonly ok: true; readonly item: LinkedinQueueItem }
  | { readonly ok: false; readonly error: 'not_found' | 'wrong_state' };

function toItem(row: QueueRow, now: number): LinkedinQueueItem {
  const due = row.state === 'queued' && Date.parse(row.scheduled_at) <= now;
  const state = (due ? 'due' : row.state) as LinkedinQueueState;
  const commentUrl = row.target_post_url && isLinkedinUrl(row.target_post_url) ? row.target_post_url : null;
  return {
    id: row.id, draftId: row.draft_id, kind: row.kind, text: row.text.slice(0, LINKEDIN_QUEUE_PREVIEW_MAX),
    scheduledAt: row.scheduled_at, state, updatedAt: row.updated_at, remindedAt: row.reminded_at,
    openUrl: due ? (row.kind === 'post' ? LINKEDIN_POST_OPEN_URL : commentUrl) : null,
  };
}

/** B694: ритм и очередь LinkedIn кандидата. Только наша база, наружу ничего не уходит. */
export class LinkedinQueueRepository {
  constructor(private readonly database: DatabaseSync, private readonly clock: () => number = Date.now) {
    database.exec(LINKEDIN_QUEUE_TABLES);
  }

  getRhythm(candidateId: string, fallbackTimezone: string): LinkedinRhythm {
    const row = this.database.prepare('SELECT posts_per_week, days, time, timezone FROM candidate_linkedin_rhythm WHERE candidate_id = ?')
      .get(candidateId) as { posts_per_week: number; days: string; time: string; timezone: string } | undefined;
    if (!row) {
      return { postsPerWeek: DEFAULT_LINKEDIN_POSTS_PER_WEEK, days: DEFAULT_LINKEDIN_RHYTHM_DAYS, time: DEFAULT_LINKEDIN_RHYTHM_TIME, timezone: fallbackTimezone };
    }
    return { postsPerWeek: row.posts_per_week, days: JSON.parse(row.days) as LinkedinRhythmDay[], time: row.time, timezone: row.timezone };
  }

  setRhythm(candidateId: string, rhythm: LinkedinRhythm): LinkedinRhythm {
    this.database.prepare(`INSERT INTO candidate_linkedin_rhythm (candidate_id, posts_per_week, days, time, timezone, updated_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(candidate_id) DO UPDATE SET posts_per_week = excluded.posts_per_week,
      days = excluded.days, time = excluded.time, timezone = excluded.timezone, updated_at = excluded.updated_at`)
      .run(candidateId, rhythm.postsPerWeek, JSON.stringify(rhythm.days), rhythm.time, rhythm.timezone, new Date(this.clock()).toISOString());
    return rhythm;
  }

  /**
   * B695: «Остановить всё» (n05) — та же пауза, что у автооткликов (`candidate_auto_apply_settings.paused_until`).
   * Пока она действует, время очереди не наступает: ни `due`, ни напоминаний.
   */
  isPaused(candidateId: string): boolean {
    const exists = this.database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidate_auto_apply_settings'").get();
    if (!exists) return false;
    const row = this.database.prepare('SELECT paused_until FROM candidate_auto_apply_settings WHERE candidate_id = ?')
      .get(candidateId) as { paused_until: string | null } | undefined;
    return Boolean(row?.paused_until && Date.parse(row.paused_until) > this.clock());
  }

  /** Момент, до которого время очереди считается наступившим; на паузе — никакое. */
  private dueBefore(candidateId: string): number {
    return this.isPaused(candidateId) ? 0 : this.clock();
  }

  list(candidateId: string, filter: { state?: LinkedinQueueState; offset: number; limit: number }): LinkedinQueuePage {
    const now = this.dueBefore(candidateId);
    const nowIso = new Date(now).toISOString();
    const where: Record<LinkedinQueueState, string> = {
      queued: "q.state = 'queued' AND q.scheduled_at > ?",
      due: "q.state = 'queued' AND q.scheduled_at <= ?",
      done: "q.state = 'done' AND ? IS NOT NULL",
      removed: "q.state = 'removed' AND ? IS NOT NULL",
    };
    const condition = filter.state ? `AND ${where[filter.state]}` : 'AND ? IS NOT NULL';
    const total = (this.database.prepare(`SELECT COUNT(*) AS n FROM candidate_linkedin_queue q WHERE q.candidate_id = ? ${condition}`)
      .get(candidateId, nowIso) as { n: number }).n;
    const rows = this.database.prepare(`${SELECT} WHERE q.candidate_id = ? ${condition} ORDER BY q.scheduled_at ASC, q.rowid ASC LIMIT ? OFFSET ?`)
      .all(candidateId, nowIso, filter.limit, filter.offset) as unknown as QueueRow[];
    return { items: rows.map((row) => toItem(row, now)), total, offset: filter.offset, limit: filter.limit, paused: now === 0 };
  }

  private find(candidateId: string, id: string): QueueRow | undefined {
    return this.database.prepare(`${SELECT} WHERE q.candidate_id = ? AND q.id = ?`).get(candidateId, id) as QueueRow | undefined;
  }

  get(candidateId: string, id: string): LinkedinQueueItem | null {
    const row = this.find(candidateId, id);
    return row ? toItem(row, this.dueBefore(candidateId)) : null;
  }

  enqueue(candidateId: string, draftId: string, at: string | undefined, rhythm: LinkedinRhythm): EnqueueResult {
    const draft = this.database.prepare('SELECT kind, status FROM candidate_drafts WHERE candidate_id = ? AND id = ?')
      .get(candidateId, draftId) as { kind: 'post' | 'comment'; status: string } | undefined;
    if (!draft || draft.status === 'rejected') return { ok: false, error: 'not_found' };
    const workflow = this.database.prepare('SELECT published_at FROM candidate_draft_workflow WHERE candidate_id = ? AND draft_id = ?')
      .get(candidateId, draftId) as { published_at: string | null } | undefined;
    if (!workflow || workflow.published_at) return { ok: false, error: 'not_approved' };
    if (this.database.prepare("SELECT 1 FROM candidate_linkedin_queue WHERE candidate_id = ? AND draft_id = ? AND state IN ('queued', 'done')").get(candidateId, draftId)) {
      return { ok: false, error: 'already_queued' };
    }
    const scheduledAt = at ?? this.freeSlot(candidateId, draft.kind, rhythm);
    if (!scheduledAt) return { ok: false, error: 'no_slot' };
    const id = randomUUID();
    const now = new Date(this.clock()).toISOString();
    this.database.prepare(`INSERT INTO candidate_linkedin_queue (id, candidate_id, draft_id, kind, scheduled_at, state, published_url, reminded_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'queued', NULL, NULL, ?, ?)`).run(id, candidateId, draftId, draft.kind, scheduledAt, now, now);
    return { ok: true, item: this.get(candidateId, id) as LinkedinQueueItem };
  }

  private freeSlot(candidateId: string, kind: 'post' | 'comment', rhythm: LinkedinRhythm): string | null {
    const rows = this.database.prepare("SELECT scheduled_at, kind FROM candidate_linkedin_queue WHERE candidate_id = ? AND state IN ('queued', 'done') ORDER BY scheduled_at DESC LIMIT 500")
      .all(candidateId) as unknown as Array<{ scheduled_at: string; kind: string }>;
    const postsByWeek = new Map<string, number>();
    for (const row of rows.filter((r) => r.kind === 'post')) {
      const key = weekKeyOfInstant(row.scheduled_at, rhythm.timezone);
      postsByWeek.set(key, (postsByWeek.get(key) ?? 0) + 1);
    }
    return nextFreeSlot({ rhythm, now: this.clock(), takenAt: rows.map((r) => r.scheduled_at), postsByWeek, respectWeeklyCap: kind === 'post' });
  }

  /** Меняет строку только в состоянии `queued` (в том числе наступившее `due`). */
  private updateQueued(candidateId: string, id: string, set: string, ...values: Array<string | null>): ChangeResult {
    const row = this.find(candidateId, id);
    if (!row) return { ok: false, error: 'not_found' };
    if (row.state !== 'queued') return { ok: false, error: 'wrong_state' };
    this.database.prepare(`UPDATE candidate_linkedin_queue SET ${set}, updated_at = ? WHERE candidate_id = ? AND id = ?`)
      .run(...values, new Date(this.clock()).toISOString(), candidateId, id);
    return { ok: true, item: this.get(candidateId, id) as LinkedinQueueItem };
  }

  reschedule(candidateId: string, id: string, at: string): ChangeResult {
    return this.updateQueued(candidateId, id, 'scheduled_at = ?, reminded_at = NULL', at);
  }

  remove(candidateId: string, id: string): ChangeResult {
    const row = this.find(candidateId, id);
    if (row?.state === 'removed') return { ok: true, item: toItem(row, this.clock()) };
    return this.updateQueued(candidateId, id, "state = 'removed'");
  }

  markPublished(candidateId: string, id: string, url: string | null): ChangeResult {
    const row = this.find(candidateId, id);
    if (row?.state === 'done') return { ok: true, item: toItem(row, this.clock()) };
    return this.updateQueued(candidateId, id, "state = 'done', published_url = ?", url);
  }

  /** Отметка «напоминание показано»: ставится один раз, только у наступившей строки. */
  markReminded(candidateId: string, id: string): ChangeResult {
    const row = this.find(candidateId, id);
    if (!row) return { ok: false, error: 'not_found' };
    const item = toItem(row, this.dueBefore(candidateId));
    if (item.state !== 'due') return { ok: false, error: 'wrong_state' };
    if (row.reminded_at) return { ok: true, item };
    return this.updateQueued(candidateId, id, 'reminded_at = ?', new Date(this.clock()).toISOString());
  }
}
