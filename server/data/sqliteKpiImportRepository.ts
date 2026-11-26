import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  kpiWeightSum,
  type CareerDiaryKpiImport,
  type CareerDiaryKpiRow,
  type CareerDiaryKpiSourceKind,
} from '../../shared/careerDiaryKpi';
import { openPayload, sealPayload } from './careerDiaryRepositoryHelpers';
import { SealedText } from './sealedText';
import { applySqliteBusyTimeout, SQLITE_HTTP_BUSY_TIMEOUT_MS } from './sqliteBusyTimeout';

/**
 * B686: загрузки KPI. Только новая таблица. Исходник (текст или файл в base64) запечатан
 * отдельно от черновика и стирается по запросу кандидата: `source_cipher` становится NULL,
 * черновик и принятые цели остаются. Удаление кандидата уносит строки каскадом.
 */
export const KPI_IMPORT_SCHEMA = `
CREATE TABLE IF NOT EXISTS career_diary_kpi_imports (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('text', 'table', 'photo')),
  source_cipher TEXT,
  draft_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, id)
) STRICT;
CREATE INDEX IF NOT EXISTS idx_career_diary_kpi_imports_recent
  ON career_diary_kpi_imports(candidate_id, created_at DESC);
CREATE TABLE IF NOT EXISTS career_diary_kpi_attempts (
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_career_diary_kpi_attempts_recent
  ON career_diary_kpi_attempts(candidate_id, created_at);
`;

const SOURCE = 'kpi-source';
const DRAFT = 'kpi-draft';

export interface KpiImportSource {
  readonly name: string | null;
  readonly mimeType: string;
  /** Текст как есть или байты файла в base64. */
  readonly content: string;
}

interface Draft {
  readonly sourceName: string | null;
  readonly rows: readonly CareerDiaryKpiRow[];
  readonly acceptedGoalIds: readonly string[];
}

interface ImportRow {
  readonly id: string;
  readonly source_kind: CareerDiaryKpiSourceKind;
  readonly has_source: number;
  readonly draft_cipher: string;
  readonly created_at: string;
}

export class SqliteKpiImportRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private readonly sealedText: SealedText;

  /** Своё соединение по пути к базе или (B689, выгрузка) чужое соединение хранилища. */
  constructor(options: DatabaseSync | { databasePath: string; encryptionKey: Buffer }, key?: Buffer) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database = options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    const encryptionKey = options instanceof DatabaseSync ? key : options.encryptionKey;
    if (!encryptionKey) throw new Error('kpi_import_encryption_key_missing');
    this.sealedText = new SealedText(encryptionKey);
    try {
      // Чужое соединение (хранилища) живёт со своими настройками ожидания и журнала.
      if (this.ownsDatabase) {
        applySqliteBusyTimeout(this.database, SQLITE_HTTP_BUSY_TIMEOUT_MS);
        this.database.exec('PRAGMA journal_mode = WAL;');
      }
      this.database.exec(KPI_IMPORT_SCHEMA);
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  create(
    candidateId: string,
    kind: CareerDiaryKpiSourceKind,
    source: KpiImportSource,
    rows: readonly CareerDiaryKpiRow[],
    now = new Date().toISOString(),
  ): CareerDiaryKpiImport {
    const id = randomUUID();
    const draft: Draft = { sourceName: source.name, rows, acceptedGoalIds: [] };
    this.database
      .prepare(
        `INSERT INTO career_diary_kpi_imports
          (candidate_id, id, source_kind, source_cipher, draft_cipher, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        candidateId,
        id,
        kind,
        sealPayload(this.sealedText, candidateId, SOURCE, id, source),
        sealPayload(this.sealedText, candidateId, DRAFT, id, draft),
        now,
        now,
      );
    return this.get(candidateId, id)!;
  }

  get(candidateId: string, id: string): CareerDiaryKpiImport | null {
    const row = this.database
      .prepare(
        `SELECT id, source_kind, source_cipher IS NOT NULL AS has_source, draft_cipher, created_at
         FROM career_diary_kpi_imports WHERE candidate_id = ? AND id = ?`,
      )
      .get(candidateId, id) as ImportRow | undefined;
    return row ? this.toImport(candidateId, row) : null;
  }

  /** B689: все загрузки кандидата с исходником, пока он не стёрт, — для выгрузки данных. */
  exportAll(candidateId: string): Array<CareerDiaryKpiImport & { source: KpiImportSource | null }> {
    const rows = this.database
      .prepare(
        `SELECT id, source_kind, source_cipher IS NOT NULL AS has_source, source_cipher, draft_cipher, created_at
         FROM career_diary_kpi_imports WHERE candidate_id = ? ORDER BY created_at, id`,
      )
      .all(candidateId) as unknown as Array<ImportRow & { readonly source_cipher: string | null }>;
    return rows.map((row) => ({
      ...this.toImport(candidateId, row),
      source: row.source_cipher
        ? openPayload<KpiImportSource>(this.sealedText, candidateId, SOURCE, row.id, row.source_cipher)
        : null,
    }));
  }

  /** Отмечает принятые цели; повтор принятия не создаёт их второй раз. */
  markAccepted(candidateId: string, id: string, goalIds: readonly string[], now = new Date().toISOString()): void {
    const current = this.draft(candidateId, id);
    if (!current) return;
    const draft: Draft = { ...current, acceptedGoalIds: goalIds };
    this.database
      .prepare(
        `UPDATE career_diary_kpi_imports SET draft_cipher = ?, updated_at = ?
         WHERE candidate_id = ? AND id = ?`,
      )
      .run(sealPayload(this.sealedText, candidateId, DRAFT, id, draft), now, candidateId, id);
  }

  /**
   * Стирает исходник и всё, что из него дословно: цитаты строк и имя файла. Остаются строки,
   * которые кандидат проверял, и принятые цели. `false` — загрузки нет.
   */
  deleteSource(candidateId: string, id: string, now = new Date().toISOString()): boolean {
    const current = this.draft(candidateId, id);
    if (!current) return false;
    const draft: Draft = {
      ...current,
      sourceName: null,
      rows: current.rows.map((row) => ({ ...row, quote: '' })),
    };
    this.database
      .prepare(
        `UPDATE career_diary_kpi_imports SET source_cipher = NULL, draft_cipher = ?, updated_at = ?
         WHERE candidate_id = ? AND id = ?`,
      )
      .run(sealPayload(this.sealedText, candidateId, DRAFT, id, draft), now, candidateId, id);
    return true;
  }

  /**
   * Записывает попытку разбора, если с `since` их меньше `limit`: каждая попытка — вызов модели,
   * поэтому считаются и неудачные. Проверка и запись — одна транзакция, параллельные запросы
   * предел не обходят. `false` — предел исчерпан.
   */
  takeAttempt(candidateId: string, since: string, limit: number, now = new Date().toISOString()): boolean {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const row = this.database
        .prepare('SELECT COUNT(*) AS total FROM career_diary_kpi_attempts WHERE candidate_id = ? AND created_at >= ?')
        .get(candidateId, since) as { total: number };
      const allowed = Number(row.total) < limit;
      if (allowed) {
        this.database
          .prepare('INSERT INTO career_diary_kpi_attempts (candidate_id, created_at) VALUES (?, ?)')
          .run(candidateId, now);
      }
      this.database
        .prepare('DELETE FROM career_diary_kpi_attempts WHERE candidate_id = ? AND created_at < ?')
        .run(candidateId, since);
      this.database.exec('COMMIT');
      return allowed;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  private draft(candidateId: string, id: string): Draft | null {
    const row = this.database
      .prepare('SELECT draft_cipher FROM career_diary_kpi_imports WHERE candidate_id = ? AND id = ?')
      .get(candidateId, id) as { draft_cipher: string } | undefined;
    return row ? openPayload<Draft>(this.sealedText, candidateId, DRAFT, id, row.draft_cipher) : null;
  }

  private toImport(candidateId: string, row: ImportRow): CareerDiaryKpiImport {
    const draft = openPayload<Draft>(this.sealedText, candidateId, DRAFT, row.id, row.draft_cipher);
    return {
      id: row.id,
      sourceKind: row.source_kind,
      sourceName: draft.sourceName,
      createdAt: row.created_at,
      rows: draft.rows,
      weightSum: kpiWeightSum(draft.rows),
      acceptedGoalIds: draft.acceptedGoalIds,
      sourceStored: Number(row.has_source) === 1,
    };
  }
}
