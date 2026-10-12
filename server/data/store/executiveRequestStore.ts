import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type {
  ExecutiveRequestInput,
  ExecutiveRequestPage,
  ExecutiveRequestPageQuery,
  ExecutiveRequestQueueQuery,
  ExecutiveRequestStatus,
  StoredExecutiveRequest,
} from '../candidateStore';
import type { SealedText } from '../sealedText';

interface ExecutiveRequestRow {
  id: string;
  candidate_id: string;
  idempotency_digest: string;
  payload_digest: string;
  request_cipher: string;
  status: ExecutiveRequestStatus;
  created_at: string;
  updated_at: string;
}

export class ExecutiveRequestIdempotencyConflictError extends Error {
  constructor() {
    super('executive_request_idempotency_conflict');
  }
}

export class ExecutiveRequestRateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('executive_request_rate_limited');
  }
}

export class ExecutiveRequestCapacityError extends Error {
  constructor() {
    super('executive_request_capacity_reached');
  }
}

export class ExecutiveRequestStatusTransitionError extends Error {
  constructor() {
    super('executive_request_status_transition_invalid');
  }
}

interface ExecutiveRequestInsertResult {
  readonly request: StoredExecutiveRequest;
  readonly created: boolean;
  readonly replayed: boolean;
}

export function insertExecutiveRequest(
  database: DatabaseSync,
  sealedText: SealedText,
  transaction: <T>(operation: () => T) => T,
  candidateId: string,
  input: ExecutiveRequestInput,
  capacity: number,
): ExecutiveRequestInsertResult {
  const idempotencyDigest = sealedText.indexToken(
    candidateId,
    'executive-request-idempotency:' + input.idempotencyKey,
  );
  const payloadDigest = sealedText.indexToken(
    candidateId,
    'executive-request-payload:' +
      normalizeForDeduplication(input.task) +
      '\u0000' +
      normalizeForDeduplication(input.timeline),
  );
  return transaction(() =>
    createOrReuseExecutiveRequest(
      database,
      sealedText,
      candidateId,
      input,
      idempotencyDigest,
      payloadDigest,
      capacity,
    ),
  );
}

function createOrReuseExecutiveRequest(
  database: DatabaseSync,
  sealedText: SealedText,
  candidateId: string,
  input: ExecutiveRequestInput,
  idempotencyDigest: string,
  payloadDigest: string,
  capacity: number,
): ExecutiveRequestInsertResult {
  const existing = findByIdempotencyKey(database, candidateId, idempotencyDigest);
  if (existing) {
    if (existing.payload_digest !== payloadDigest) {
      throw new ExecutiveRequestIdempotencyConflictError();
    }
    return { request: toStoredRequest(existing, sealedText), created: false, replayed: true };
  }

  const duplicate = findActiveDuplicate(database, candidateId, payloadDigest);
  if (duplicate) {
    return { request: toStoredRequest(duplicate, sealedText), created: false, replayed: false };
  }
  assertCandidateRequestLimit(database, candidateId);
  const status = activeRequestCount(database) < capacity ? 'submitted' : 'waitlisted';
  return persistExecutiveRequest(
    database,
    sealedText,
    candidateId,
    input,
    idempotencyDigest,
    payloadDigest,
    status,
  );
}

function findByIdempotencyKey(
  database: DatabaseSync,
  candidateId: string,
  idempotencyDigest: string,
): ExecutiveRequestRow | undefined {
  return database
    .prepare('SELECT * FROM executive_requests WHERE candidate_id = ? AND idempotency_digest = ?')
    .get(candidateId, idempotencyDigest) as ExecutiveRequestRow | undefined;
}

function findActiveDuplicate(
  database: DatabaseSync,
  candidateId: string,
  payloadDigest: string,
): ExecutiveRequestRow | undefined {
  return database
    .prepare(
      `SELECT * FROM executive_requests
       WHERE candidate_id = ? AND payload_digest = ?
         AND status IN ('submitted', 'waitlisted', 'in_review', 'accepted')
       ORDER BY created_at DESC, id DESC
       LIMIT 1`,
    )
    .get(candidateId, payloadDigest) as ExecutiveRequestRow | undefined;
}

function assertCandidateRequestLimit(database: DatabaseSync, candidateId: string): void {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 60 * 60 * 1_000).toISOString();
  const recent = database
    .prepare(
      `SELECT created_at
       FROM executive_requests
       WHERE candidate_id = ? AND created_at >= ?
       ORDER BY created_at ASC
       LIMIT 3`,
    )
    .all(candidateId, cutoff) as { created_at: string }[];
  if (recent.length < 3) return;
  const nextAllowedAt = Date.parse(recent[0]!.created_at) + 60 * 60 * 1_000;
  throw new ExecutiveRequestRateLimitError(
    Math.max(1, Math.ceil((nextAllowedAt - now.getTime()) / 1_000)),
  );
}

function activeRequestCount(database: DatabaseSync): number {
  const result = database
    .prepare(
      `SELECT COUNT(*) AS count
       FROM executive_requests
       WHERE status IN ('submitted', 'in_review', 'accepted')`,
    )
    .get() as { count: number };
  return result.count;
}

function persistExecutiveRequest(
  database: DatabaseSync,
  sealedText: SealedText,
  candidateId: string,
  input: ExecutiveRequestInput,
  idempotencyDigest: string,
  payloadDigest: string,
  status: ExecutiveRequestStatus,
): ExecutiveRequestInsertResult {
  const now = new Date().toISOString();
  const id = randomUUID();
  const requestCipher = sealedText.seal(
    JSON.stringify({ task: input.task, timeline: input.timeline }),
    associatedData(candidateId, id),
  );
  database
    .prepare(
      `INSERT INTO executive_requests (
        id, candidate_id, idempotency_digest, payload_digest, request_cipher, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, candidateId, idempotencyDigest, payloadDigest, requestCipher, status, now, now);
  return {
    request: { id, task: input.task, timeline: input.timeline, status, createdAt: now, updatedAt: now },
    created: true,
    replayed: false,
  };
}

export function selectExecutiveRequests(
  database: DatabaseSync,
  sealedText: SealedText,
  candidateId: string,
  query: ExecutiveRequestPageQuery,
): ExecutiveRequestPage<StoredExecutiveRequest> {
  const limit = boundedLimit(query.limit);
  const values: Array<string | number> = [candidateId];
  const clauses = ['candidate_id = ?'];
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor) {
    clauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
    values.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const rows = database
    .prepare(
      `SELECT * FROM executive_requests
       WHERE ` + clauses.join(' AND ') + `
       ORDER BY created_at DESC, id DESC
       LIMIT ?`,
    )
    .all(...values, limit + 1) as unknown as ExecutiveRequestRow[];
  return pageOf(rows, limit, (row) => toStoredRequest(row, sealedText));
}

export function selectExecutiveRequest(
  database: DatabaseSync,
  sealedText: SealedText,
  candidateId: string,
  requestId: string,
): StoredExecutiveRequest | null {
  const row = database
    .prepare('SELECT * FROM executive_requests WHERE candidate_id = ? AND id = ?')
    .get(candidateId, requestId) as ExecutiveRequestRow | undefined;
  return row ? toStoredRequest(row, sealedText) : null;
}

export function exportExecutiveRequests(
  database: DatabaseSync,
  sealedText: SealedText,
  candidateId: string,
): StoredExecutiveRequest[] {
  const rows = database
    .prepare(
      'SELECT * FROM executive_requests WHERE candidate_id = ? ORDER BY created_at DESC, id DESC',
    )
    .all(candidateId) as unknown as ExecutiveRequestRow[];
  return rows.map((row) => toStoredRequest(row, sealedText));
}

export function selectExecutiveRequestQueue(
  database: DatabaseSync,
  sealedText: SealedText,
  query: ExecutiveRequestQueueQuery,
): ExecutiveRequestPage<StoredExecutiveRequest & { readonly candidateId: string }> {
  const limit = boundedLimit(query.limit);
  const values: Array<string | number> = [];
  const clauses: string[] = [];
  if (query.status) {
    clauses.push('status = ?');
    values.push(query.status);
  }
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  if (cursor) {
    clauses.push('(created_at < ? OR (created_at = ? AND id < ?))');
    values.push(cursor.createdAt, cursor.createdAt, cursor.id);
  }
  const where = clauses.length > 0 ? ' WHERE ' + clauses.join(' AND ') : '';
  const rows = database
    .prepare(
      'SELECT * FROM executive_requests' +
        where +
        ' ORDER BY created_at DESC, id DESC LIMIT ?',
    )
    .all(...values, limit + 1) as unknown as ExecutiveRequestRow[];
  return pageOf(rows, limit, (row) => ({
    ...toStoredRequest(row, sealedText),
    candidateId: row.candidate_id,
  }));
}

export function updateExecutiveRequestStatus(
  database: DatabaseSync,
  sealedText: SealedText,
  transaction: <T>(operation: () => T) => T,
  requestId: string,
  status: ExecutiveRequestStatus,
  capacity: number,
): StoredExecutiveRequest | null {
  return transaction(() => {
    const row = database
      .prepare('SELECT * FROM executive_requests WHERE id = ?')
      .get(requestId) as ExecutiveRequestRow | undefined;
    if (!row) return null;
    if (row.status === status) return toStoredRequest(row, sealedText);
    if (!allowedTransitions[row.status].includes(status)) {
      throw new ExecutiveRequestStatusTransitionError();
    }
    if (isActiveStatus(status) && !isActiveStatus(row.status)) {
      const active = database
        .prepare(
          `SELECT COUNT(*) AS count
           FROM executive_requests
           WHERE id <> ? AND status IN ('submitted', 'in_review', 'accepted')`,
        )
        .get(requestId) as { count: number };
      if (active.count >= capacity) throw new ExecutiveRequestCapacityError();
    }
    const updatedAt = new Date().toISOString();
    database
      .prepare('UPDATE executive_requests SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, updatedAt, requestId);
    return { ...toStoredRequest(row, sealedText), status, updatedAt };
  });
}

const allowedTransitions: Readonly<Record<ExecutiveRequestStatus, readonly ExecutiveRequestStatus[]>> = {
  submitted: ['in_review', 'waitlisted', 'declined'],
  waitlisted: ['in_review', 'declined'],
  in_review: ['accepted', 'declined', 'waitlisted', 'completed'],
  accepted: ['declined', 'completed'],
  declined: [],
  completed: [],
};

function isActiveStatus(status: ExecutiveRequestStatus): boolean {
  return status === 'submitted' || status === 'in_review' || status === 'accepted';
}

function boundedLimit(limit: number): number {
  return Math.max(1, Math.min(limit, 100));
}

function normalizeForDeduplication(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase();
}

function pageOf<T>(
  rows: ExecutiveRequestRow[],
  limit: number,
  map: (row: ExecutiveRequestRow) => T,
): ExecutiveRequestPage<T> {
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return {
    items: items.map(map),
    nextCursor: rows.length > limit && last ? encodeCursor(last.created_at, last.id) : null,
  };
}

function encodeCursor(createdAt: string, id: string): string {
  return Buffer.from(createdAt + '\u0000' + id, 'utf8').toString('base64url');
}

function decodeCursor(value: string): { readonly createdAt: string; readonly id: string } {
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    const separator = decoded.indexOf('\u0000');
    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (separator < 1 || !id || !Number.isFinite(Date.parse(createdAt))) {
      throw new Error('invalid');
    }
    return { createdAt, id };
  } catch {
    throw new Error('executive_request_invalid_cursor');
  }
}

function toStoredRequest(row: ExecutiveRequestRow, sealedText: SealedText): StoredExecutiveRequest {
  const input = JSON.parse(
    sealedText.open(row.request_cipher, associatedData(row.candidate_id, row.id)),
  ) as { task: string; timeline: string };
  return {
    id: row.id,
    task: input.task,
    timeline: input.timeline,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function associatedData(candidateId: string, requestId: string): string {
  return 'executive-request:v1:' + candidateId + ':' + requestId;
}
