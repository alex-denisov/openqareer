import type { DatabaseSync } from 'node:sqlite';
import { LINKEDIN_QUEUE_PREVIEW_MAX } from '../../shared/b640LinkedinQueue';
import type { JournalPublication } from '../domain/b640LinkedinJournal';

interface Row {
  id: string;
  draft_id: string;
  kind: string;
  text: string;
  state: string;
  at: string;
  url: string | null;
}

const preview = (text: string): string =>
  text.length <= LINKEDIN_QUEUE_PREVIEW_MAX ? text : `${text.slice(0, LINKEDIN_QUEUE_PREVIEW_MAX - 1).trimEnd()}…`;

const hasTable = (database: DatabaseSync, name: string): boolean =>
  Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

function queueRows(database: DatabaseSync, candidateId: string): Row[] {
  if (!hasTable(database, 'candidate_linkedin_queue')) return [];
  return database
    .prepare(
      `SELECT q.id, q.draft_id, q.kind, d.text, q.state, q.updated_at AS at, q.published_url AS url
       FROM candidate_linkedin_queue q JOIN candidate_drafts d ON d.id = q.draft_id AND d.candidate_id = q.candidate_id
       WHERE q.candidate_id = ? AND q.state IN ('done', 'removed')`,
    )
    .all(candidateId) as unknown as Row[];
}

function markedRows(database: DatabaseSync, candidateId: string): Row[] {
  if (!hasTable(database, 'candidate_draft_workflow')) return [];
  return database
    .prepare(
      `SELECT d.id, d.id AS draft_id, d.kind, d.text, 'done' AS state, w.published_at AS at, NULL AS url
       FROM candidate_draft_workflow w JOIN candidate_drafts d ON d.id = w.draft_id AND d.candidate_id = w.candidate_id
       WHERE w.candidate_id = ? AND w.published_at IS NOT NULL`,
    )
    .all(candidateId) as unknown as Row[];
}

function toPublication(prefix: 'queue' | 'draft', row: Row): JournalPublication[] {
  const kind = row.kind === 'comment' ? 'comment' : row.kind === 'post' ? 'post' : null;
  const state = row.state === 'done' || row.state === 'removed' ? row.state : null;
  if (!kind || !state) return [];
  return [{ id: `${prefix}:${row.id}`, kind, state, text: preview(row.text), at: row.at, url: row.url }];
}

/**
 * B696: публикации кандидата из нашего хранения — строки очереди B694 («опубликовал», «убрал») и
 * отметки «опубликован» у черновиков. Черновик, опубликованный через очередь, берётся один раз: из очереди.
 */
export function readJournalPublications(database: DatabaseSync, candidateId: string): JournalPublication[] {
  if (!hasTable(database, 'candidate_drafts')) return [];
  const queued = queueRows(database, candidateId);
  const viaQueue = new Set(queued.filter((row) => row.state === 'done').map((row) => row.draft_id));
  const marked = markedRows(database, candidateId).filter((row) => !viaQueue.has(row.draft_id));
  return [
    ...queued.flatMap((row) => toPublication('queue', row)),
    ...marked.flatMap((row) => toPublication('draft', row)),
  ];
}
