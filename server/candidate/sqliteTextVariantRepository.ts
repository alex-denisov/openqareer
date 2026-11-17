import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  MAX_TEXT_VARIANTS,
  type TextVariant,
  type TextVariantKind,
  type TextVariantList,
  type VariantWish,
} from '../../shared/textVariants';
import { SealedText } from '../data/sealedText';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';

/**
 * B682: другие варианты одного текста. Только новая таблица; пустая до первого варианта.
 * Текст и его данные запечатаны. Предел в три варианта держит сама запись: четвёртая строка
 * с тем же текстом не создаётся.
 */
export const TEXT_VARIANT_SCHEMA = `
CREATE TABLE IF NOT EXISTS text_variants (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND ${MAX_TEXT_VARIANTS}),
  text_cipher TEXT NOT NULL,
  payload_cipher TEXT,
  wish_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (candidate_id, kind, subject_id, position)
) STRICT;
`;

export interface TextSubject {
  readonly candidateId: string;
  readonly kind: TextVariantKind;
  /** Чей это текст: вакансия у письма, черновик у поста. */
  readonly subjectId: string;
}

export interface NewTextVariant extends TextSubject {
  readonly text: string;
  readonly wish: VariantWish;
  readonly payload?: unknown;
  readonly createdAt: string;
}

interface Row {
  id: string;
  position: number;
  text_cipher: string;
  payload_cipher: string | null;
  wish_json: string;
  created_at: string;
}

export class SqliteTextVariantRepository {
  private readonly database: DatabaseSync;
  private readonly ownsDatabase: boolean;
  private readonly sealedText: SealedText;

  constructor(options: DatabaseSync | { databasePath: string; encryptionKey: Buffer }, key?: Buffer) {
    this.ownsDatabase = !(options instanceof DatabaseSync);
    this.database =
      options instanceof DatabaseSync ? options : new DatabaseSync(options.databasePath);
    const encryptionKey = options instanceof DatabaseSync ? key : options.encryptionKey;
    if (!encryptionKey) throw new Error('text_variant_encryption_key_missing');
    this.sealedText = new SealedText(encryptionKey);
    if (this.ownsDatabase) this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(TEXT_VARIANT_SCHEMA);
  }

  close(): void {
    if (this.ownsDatabase) this.database.close();
  }

  private scope(subject: TextSubject, id: string): string {
    return `text-variant:${subject.candidateId}:${subject.kind}:${subject.subjectId}:${id}`;
  }

  /** Повреждённая строка не роняет список: такой вариант пропускается. */
  private open(subject: TextSubject, row: Row): TextVariant | null {
    try {
      const scope = this.scope(subject, row.id);
      return {
        id: row.id,
        position: row.position,
        text: this.sealedText.open(row.text_cipher, scope),
        wish: JSON.parse(row.wish_json) as VariantWish,
        createdAt: row.created_at,
        payload: row.payload_cipher
          ? (JSON.parse(this.sealedText.open(row.payload_cipher, scope)) as unknown)
          : null,
      };
    } catch {
      return null;
    }
  }

  count(subject: TextSubject): number {
    const row = this.database
      .prepare(
        'SELECT COUNT(*) AS n FROM text_variants WHERE candidate_id = ? AND kind = ? AND subject_id = ?',
      )
      .get(subject.candidateId, subject.kind, subject.subjectId) as { n: number };
    return row.n;
  }

  list(subject: TextSubject): TextVariantList {
    const rows = this.database
      .prepare(
        `SELECT id, position, text_cipher, payload_cipher, wish_json, created_at
         FROM text_variants WHERE candidate_id = ? AND kind = ? AND subject_id = ?
         ORDER BY position`,
      )
      .all(subject.candidateId, subject.kind, subject.subjectId) as unknown as Row[];
    return {
      variants: rows.flatMap((row) => {
        const variant = this.open(subject, row);
        return variant ? [variant] : [];
      }),
      remaining: Math.max(0, MAX_TEXT_VARIANTS - rows.length),
    };
  }

  /** Новый вариант; `null` — предел исчерпан, строка не создана. */
  add(input: NewTextVariant): TextVariant | null {
    const id = randomUUID();
    const scope = this.scope(input, id);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const position = this.count(input) + 1;
      if (position > MAX_TEXT_VARIANTS) {
        this.database.exec('ROLLBACK');
        return null;
      }
      this.database
        .prepare(
          `INSERT INTO text_variants
             (id, candidate_id, kind, subject_id, position, text_cipher, payload_cipher, wish_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.candidateId,
          input.kind,
          input.subjectId,
          position,
          this.sealedText.seal(input.text, scope),
          input.payload === undefined ? null : this.sealedText.seal(JSON.stringify(input.payload), scope),
          JSON.stringify(input.wish),
          input.createdAt,
        );
      this.database.exec('COMMIT');
      return {
        id,
        position,
        text: input.text,
        wish: input.wish,
        createdAt: input.createdAt,
        payload: input.payload ?? null,
      };
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}
