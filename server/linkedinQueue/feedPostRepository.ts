import type { DatabaseSync } from 'node:sqlite';
import type { FeedPostItem, FeedPostPage, FeedPostState } from '../../shared/b640FeedComments';
import { FEED_POST_TABLES } from '../data/feedPostSchema';

interface Row {
  draft_id: string; post_url: string | null; excerpt: string; created_at: string; text: string;
  approved_at: string | null; published_at: string | null; queue_state: string | null; scheduled_at: string | null;
}

const FROM = `FROM candidate_feed_posts f
  JOIN candidate_drafts d ON d.id = f.draft_id AND d.candidate_id = f.candidate_id AND d.status <> 'rejected'
  LEFT JOIN candidate_draft_workflow w ON w.draft_id = f.draft_id
  LEFT JOIN candidate_linkedin_queue q ON q.draft_id = f.draft_id AND q.candidate_id = f.candidate_id AND q.state IN ('queued', 'done')`;

function stateOf(row: Row): FeedPostState {
  if (row.published_at || row.queue_state === 'done') return 'published';
  if (row.queue_state === 'queued') return 'queued';
  return row.approved_at ? 'approved' : 'draft';
}

function toItem(row: Row): FeedPostItem {
  return {
    draftId: row.draft_id, postUrl: row.post_url, postExcerpt: row.excerpt, comment: row.text,
    state: stateOf(row), createdAt: row.created_at, scheduledAt: row.queue_state === 'queued' ? row.scheduled_at : null,
  };
}

/** B396: принесённые кандидатом посты и состояние их комментариев. Только наша база. */
export class FeedPostRepository {
  constructor(private readonly database: DatabaseSync) {
    database.exec(FEED_POST_TABLES);
  }

  add(candidateId: string, draftId: string, postUrl: string | null, excerpt: string, createdAt: string): void {
    this.database.prepare('INSERT INTO candidate_feed_posts (draft_id, candidate_id, post_url, excerpt, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(draftId, candidateId, postUrl, excerpt, createdAt);
  }

  owns(candidateId: string, draftId: string): boolean {
    return Boolean(this.database.prepare(`SELECT 1 ${FROM} WHERE f.candidate_id = ? AND f.draft_id = ?`).get(candidateId, draftId));
  }

  /** Состояние одного комментария; `null`, если пост не принесён этим кандидатом. */
  stateOf(candidateId: string, draftId: string): FeedPostState | null {
    const row = this.database.prepare(`${this.select()} WHERE f.candidate_id = ? AND f.draft_id = ?`).get(candidateId, draftId) as Row | undefined;
    return row ? stateOf(row) : null;
  }

  list(candidateId: string, offset: number, limit: number): FeedPostPage {
    const total = (this.database.prepare(`SELECT COUNT(DISTINCT f.draft_id) AS n ${FROM} WHERE f.candidate_id = ?`).get(candidateId) as { n: number }).n;
    const rows = this.database.prepare(`${this.select()} WHERE f.candidate_id = ? ORDER BY f.created_at DESC, f.rowid DESC LIMIT ? OFFSET ?`)
      .all(candidateId, limit, offset) as unknown as Row[];
    return { items: rows.map(toItem), total, offset, limit };
  }

  private select(): string {
    return `SELECT f.draft_id, f.post_url, f.excerpt, f.created_at, d.text, w.approved_at, w.published_at,
      q.state AS queue_state, q.scheduled_at ${FROM}`;
  }
}
