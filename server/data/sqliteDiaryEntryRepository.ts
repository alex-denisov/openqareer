import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  diaryWeekStart,
  shiftDiaryDate,
  type CareerDiaryEntry,
  type CareerDiaryEntryInput,
  type CareerDiaryEntryKind,
  type CareerDiaryEntryPatch,
  type CareerDiaryWeekSummary,
  type CareerDiaryWeekSummaryInput,
} from '../../shared/careerDiaryEntries';
import { openPayload, sealPayload } from './careerDiaryRepositoryHelpers';
import { DIARY_ENTRIES_MIGRATION } from './diaryEntrySchema';
import type { SealedText } from './sealedText';

interface EntryRow {
  readonly id: string;
  readonly entry_date: string;
  readonly kind: CareerDiaryEntryKind;
  readonly goal_id: string | null;
  readonly payload_cipher: string;
  readonly created_at: string;
  readonly updated_at: string;
}

interface SummaryRow {
  readonly week_start: string;
  readonly payload_cipher: string;
}

interface FeedCursor {
  readonly date: string;
  readonly createdAt: string;
  readonly id: string;
}

export interface DiaryEntryFilter {
  readonly kind?: CareerDiaryEntryKind;
  readonly goalId?: string;
}

export interface DiaryEntryPage {
  readonly items: CareerDiaryEntry[];
  readonly nextCursor: string | null;
}

/** Ключ идемпотентности уже использован для записи с другими данными. */
export class DiaryEntryKeyReusedError extends Error {
  constructor() {
    super('diary entry idempotency key reused');
    this.name = 'DiaryEntryKeyReusedError';
  }
}

export class InvalidDiaryEntryCursorError extends Error {
  constructor() {
    super('invalid diary entry cursor');
    this.name = 'InvalidDiaryEntryCursorError';
  }
}

const ENTRY_COLUMNS = 'id, entry_date, kind, goal_id, payload_cipher, created_at, updated_at';
const FEED_ORDER = 'ORDER BY entry_date DESC, created_at DESC, id DESC';
const MAX_PAGE = 50;
/** Записей одной недели в итоге; больше в неделю не помещается и в ленту на экране. */
const WEEK_LIMIT = 500;

function encodeCursor(row: EntryRow): string {
  const cursor: FeedCursor = { date: row.entry_date, createdAt: row.created_at, id: row.id };
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string | undefined): FeedCursor | null {
  if (cursor === undefined) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as FeedCursor;
    const texts = [parsed.date, parsed.createdAt, parsed.id];
    if (texts.some((value) => typeof value !== 'string')) throw new InvalidDiaryEntryCursorError();
    return { date: parsed.date, createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    throw new InvalidDiaryEntryCursorError();
  }
}

/** B683: записи дневника и итоги недель кандидата. */
export class SqliteDiaryEntryRepository {
  constructor(
    private readonly database: DatabaseSync,
    private readonly sealedText: SealedText,
  ) {
    this.database.exec(DIARY_ENTRIES_MIGRATION);
  }

  /**
   * Создаёт запись; повтор с тем же ключом возвращает уже созданную.
   * `null` — у кандидата уже `limit` записей.
   */
  create(
    candidateId: string,
    input: CareerDiaryEntryInput,
    idempotencyKey: string,
    now = new Date().toISOString(),
    limit = Number.POSITIVE_INFINITY,
  ): CareerDiaryEntry | null {
    const replay = this.database
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM career_diary_entries
         WHERE candidate_id = ? AND idempotency_key = ?`,
      )
      .get(candidateId, idempotencyKey) as EntryRow | undefined;
    if (replay) return this.replayed(this.toEntry(candidateId, replay), input);
    if (this.count(candidateId) >= limit) return null;
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO career_diary_entries
          (candidate_id, id, entry_date, kind, goal_id, idempotency_key, payload_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        candidateId,
        id,
        input.date,
        input.kind,
        input.goalId ?? null,
        idempotencyKey,
        this.seal(candidateId, id, input.text),
        now,
        now,
      );
    return this.get(candidateId, id)!;
  }

  get(candidateId: string, id: string): CareerDiaryEntry | null {
    const row = this.database
      .prepare(`SELECT ${ENTRY_COLUMNS} FROM career_diary_entries WHERE candidate_id = ? AND id = ?`)
      .get(candidateId, id) as EntryRow | undefined;
    return row ? this.toEntry(candidateId, row) : null;
  }

  update(
    candidateId: string,
    id: string,
    patch: CareerDiaryEntryPatch,
    now = new Date().toISOString(),
  ): CareerDiaryEntry | null {
    const current = this.get(candidateId, id);
    if (!current) return null;
    const next = {
      date: patch.date ?? current.date,
      kind: patch.kind ?? current.kind,
      text: patch.text ?? current.text,
      goalId: patch.goalId === undefined ? current.goalId : patch.goalId,
    };
    this.database
      .prepare(
        `UPDATE career_diary_entries
         SET entry_date = ?, kind = ?, goal_id = ?, payload_cipher = ?, updated_at = ?
         WHERE candidate_id = ? AND id = ?`,
      )
      .run(next.date, next.kind, next.goalId, this.seal(candidateId, id, next.text), now, candidateId, id);
    return this.get(candidateId, id);
  }

  delete(candidateId: string, id: string): boolean {
    const result = this.database
      .prepare('DELETE FROM career_diary_entries WHERE candidate_id = ? AND id = ?')
      .run(candidateId, id);
    return Number(result.changes) > 0;
  }

  /** Лента: новые сверху, порциями; фильтр по типу и по цели. */
  list(
    candidateId: string,
    limit: number,
    cursor?: string,
    filter: DiaryEntryFilter = {},
  ): DiaryEntryPage {
    const after = decodeCursor(cursor);
    const size = Math.max(1, Math.min(limit, MAX_PAGE));
    const conditions: Array<readonly [string, readonly string[]]> = [
      ['candidate_id = ?', [candidateId]],
      ...(filter.kind ? [['kind = ?', [filter.kind]] as const] : []),
      ...(filter.goalId ? [['goal_id = ?', [filter.goalId]] as const] : []),
      ...(after
        ? [['(entry_date, created_at, id) < (?, ?, ?)', [after.date, after.createdAt, after.id]] as const]
        : []),
    ];
    const where = conditions.map(([sql]) => sql);
    const values = conditions.flatMap(([, bound]) => bound);
    const rows = this.database
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM career_diary_entries
         WHERE ${where.join(' AND ')} ${FEED_ORDER} LIMIT ?`,
      )
      .all(...values, size + 1) as unknown as EntryRow[];
    const page = rows.slice(0, size);
    return {
      items: page.map((row) => this.toEntry(candidateId, row)),
      nextCursor: rows.length > size ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  /** Записи одной недели, новые сверху. */
  listWeek(candidateId: string, weekStart: string): CareerDiaryEntry[] {
    const weekEnd = shiftDiaryDate(weekStart, 6) ?? weekStart;
    const rows = this.database
      .prepare(
        `SELECT ${ENTRY_COLUMNS} FROM career_diary_entries
         WHERE candidate_id = ? AND entry_date BETWEEN ? AND ? ${FEED_ORDER} LIMIT ${WEEK_LIMIT}`,
      )
      .all(candidateId, weekStart, weekEnd) as unknown as EntryRow[];
    return rows.map((row) => this.toEntry(candidateId, row));
  }

  saveSummary(
    candidateId: string,
    weekStart: string,
    input: CareerDiaryWeekSummaryInput,
    now = new Date().toISOString(),
  ): CareerDiaryWeekSummary {
    const previous = this.getSummary(candidateId, weekStart);
    const summary: CareerDiaryWeekSummary = {
      ...input,
      weekStart,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
    };
    this.database
      .prepare(
        `INSERT INTO career_diary_week_summaries
          (candidate_id, week_start, payload_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(candidate_id, week_start) DO UPDATE SET
           payload_cipher = excluded.payload_cipher, updated_at = excluded.updated_at`,
      )
      .run(
        candidateId,
        weekStart,
        sealPayload(this.sealedText, candidateId, 'week-summary', weekStart, summary),
        summary.createdAt,
        now,
      );
    return summary;
  }

  getSummary(candidateId: string, weekStart: string): CareerDiaryWeekSummary | null {
    return this.listSummaries(candidateId, [weekStart])[0] ?? null;
  }

  /** Последний сохранённый итог перед неделей, не старше `since`: из него переносятся обещания. */
  latestSummaryBefore(
    candidateId: string,
    weekStart: string,
    since: string,
  ): CareerDiaryWeekSummary | null {
    const row = this.database
      .prepare(
        `SELECT week_start, payload_cipher FROM career_diary_week_summaries
         WHERE candidate_id = ? AND week_start < ? AND week_start >= ?
         ORDER BY week_start DESC LIMIT 1`,
      )
      .get(candidateId, weekStart, since) as SummaryRow | undefined;
    return row ? this.openSummary(candidateId, row) : null;
  }

  /** Сохранённые итоги названных недель, новые сверху. */
  listSummaries(candidateId: string, weekStarts: readonly string[]): CareerDiaryWeekSummary[] {
    if (weekStarts.length === 0) return [];
    const marks = weekStarts.map(() => '?').join(', ');
    const rows = this.database
      .prepare(
        `SELECT week_start, payload_cipher FROM career_diary_week_summaries
         WHERE candidate_id = ? AND week_start IN (${marks}) ORDER BY week_start DESC`,
      )
      .all(candidateId, ...weekStarts) as unknown as SummaryRow[];
    return rows.map((row) => this.openSummary(candidateId, row));
  }

  /** Всё, что кандидат записал: для выгрузки его данных. */
  exportAll(candidateId: string): {
    entries: CareerDiaryEntry[];
    weekSummaries: CareerDiaryWeekSummary[];
  } {
    const entries = this.database
      .prepare(`SELECT ${ENTRY_COLUMNS} FROM career_diary_entries WHERE candidate_id = ? ${FEED_ORDER}`)
      .all(candidateId) as unknown as EntryRow[];
    const summaries = this.database
      .prepare(
        `SELECT week_start, payload_cipher FROM career_diary_week_summaries
         WHERE candidate_id = ? ORDER BY week_start DESC`,
      )
      .all(candidateId) as unknown as SummaryRow[];
    return {
      entries: entries.map((row) => this.toEntry(candidateId, row)),
      weekSummaries: summaries.map((row) => this.openSummary(candidateId, row)),
    };
  }

  /** Сколько записей у кандидата: по числу ставится предел. */
  count(candidateId: string): number {
    const row = this.database
      .prepare('SELECT COUNT(*) AS total FROM career_diary_entries WHERE candidate_id = ?')
      .get(candidateId) as { total: number };
    return Number(row.total);
  }

  private replayed(entry: CareerDiaryEntry, input: CareerDiaryEntryInput): CareerDiaryEntry {
    const same =
      entry.date === input.date &&
      entry.kind === input.kind &&
      entry.text === input.text &&
      entry.goalId === (input.goalId ?? null);
    if (!same) throw new DiaryEntryKeyReusedError();
    return entry;
  }

  private seal(candidateId: string, id: string, text: string): string {
    return sealPayload(this.sealedText, candidateId, 'entry', id, { text });
  }

  private openSummary(candidateId: string, row: SummaryRow): CareerDiaryWeekSummary {
    return openPayload<CareerDiaryWeekSummary>(
      this.sealedText,
      candidateId,
      'week-summary',
      row.week_start,
      row.payload_cipher,
    );
  }

  private toEntry(candidateId: string, row: EntryRow): CareerDiaryEntry {
    const payload = openPayload<{ text: string }>(
      this.sealedText,
      candidateId,
      'entry',
      row.id,
      row.payload_cipher,
    );
    return {
      id: row.id,
      date: row.entry_date,
      weekStart: diaryWeekStart(row.entry_date) ?? row.entry_date,
      kind: row.kind,
      text: payload.text,
      goalId: row.goal_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
