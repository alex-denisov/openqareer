import type { DatabaseSync } from 'node:sqlite';
import type { SealedText } from './sealedText';

export interface PayloadRow {
  readonly id: string;
  readonly payload_cipher: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly goal_id?: string;
  readonly measured_at?: string;
  readonly week_start?: string;
}

export interface MeasurementRow extends PayloadRow {
  readonly goal_id: string;
  readonly measured_at: string;
}

export interface WeeklyReviewRow {
  readonly id: string;
  readonly week_start: string;
  readonly payload_cipher: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export type DiaryTable =
  | 'career_diary_goals'
  | 'career_diary_measurements'
  | 'career_diary_weekly_reviews'
  | 'career_diary_achievements'
  | 'career_diary_workplaces';
export type DiarySortColumn = 'created_at' | 'measured_at' | 'week_start';

interface DiaryCursor {
  readonly scope: DiaryTable;
  readonly sortValue: string;
  readonly id: string;
}

export interface DiaryPageRows {
  readonly rows: PayloadRow[];
  readonly nextCursor: string | null;
}

export class InvalidCareerDiaryCursorError extends Error {
  constructor() {
    super('invalid career diary cursor');
    this.name = 'InvalidCareerDiaryCursorError';
  }
}

export function associatedData(candidateId: string, collection: string, key: string): string {
  return 'openqareer:career-diary:v1:' + candidateId + ':' + collection + ':' + key;
}

export function sealPayload<T>(
  sealedText: SealedText,
  candidateId: string,
  collection: string,
  key: string,
  payload: T,
): string {
  return sealedText.seal(JSON.stringify(payload), associatedData(candidateId, collection, key));
}

export function openPayload<T>(
  sealedText: SealedText,
  candidateId: string,
  collection: string,
  key: string,
  payloadCipher: string,
): T {
  return JSON.parse(
    sealedText.open(payloadCipher, associatedData(candidateId, collection, key)),
  ) as T;
}

function encodeDiaryCursor(scope: DiaryTable, sortValue: string, id: string): string {
  return Buffer.from(JSON.stringify({ version: 1, scope, sortValue, id }), 'utf8').toString('base64url');
}

function decodeDiaryCursor(cursor: string | undefined, scope: DiaryTable): DiaryCursor | null {
  if (cursor === undefined) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    if (
      parsed.version !== 1 ||
      parsed.scope !== scope ||
      typeof parsed.sortValue !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      throw new InvalidCareerDiaryCursorError();
    }
    return { scope, sortValue: parsed.sortValue, id: parsed.id };
  } catch {
    throw new InvalidCareerDiaryCursorError();
  }
}

function cursorSortValue(row: PayloadRow, orderColumn: DiarySortColumn): string {
  if (orderColumn === 'created_at') return row.created_at;
  if (orderColumn === 'measured_at') return row.measured_at ?? '';
  return row.week_start ?? '';
}

export function pagePayloadRows(
  database: DatabaseSync,
  table: DiaryTable,
  candidateId: string,
  limit: number,
  cursor: string | undefined,
  orderColumn: DiarySortColumn,
  goalId?: string,
): DiaryPageRows {
  const pageLimit = Math.max(1, Math.min(limit, 100));
  const decoded = decodeDiaryCursor(cursor, table);
  const clauses = ['candidate_id = ?'];
  const parameters: Array<string | number> = [candidateId];
  if (goalId !== undefined) {
    clauses.push('goal_id = ?');
    parameters.push(goalId);
  }
  if (decoded) {
    if (orderColumn === 'week_start') {
      clauses.push('week_start < ?');
      parameters.push(decoded.sortValue);
    } else {
      clauses.push('(' + orderColumn + ' < ? OR (' + orderColumn + ' = ? AND id < ?))');
      parameters.push(decoded.sortValue, decoded.sortValue, decoded.id);
    }
  }
  const extraColumns = table === 'career_diary_measurements'
    ? ', goal_id, measured_at'
    : table === 'career_diary_weekly_reviews' ? ', week_start' : '';
  const idColumn = table === 'career_diary_weekly_reviews' ? 'week_start AS id' : 'id';
  const updatedColumn = table === 'career_diary_measurements'
    ? 'created_at AS updated_at'
    : 'updated_at';
  const tieColumn = orderColumn === 'week_start' ? 'week_start' : 'id';
  const query = 'SELECT ' + idColumn + ', payload_cipher, created_at, ' + updatedColumn + extraColumns +
    ' FROM ' + table + ' WHERE ' + clauses.join(' AND ') +
    ' ORDER BY ' + orderColumn + ' DESC, ' + tieColumn + ' DESC LIMIT ?';
  const rows = database.prepare(query).all(...parameters, pageLimit + 1) as unknown as PayloadRow[];
  const hasMore = rows.length > pageLimit;
  const pageRows = rows.slice(0, pageLimit);
  const last = pageRows[pageRows.length - 1];
  return {
    rows: pageRows,
    nextCursor: hasMore && last
      ? encodeDiaryCursor(table, cursorSortValue(last, orderColumn), last.id)
      : null,
  };
}
