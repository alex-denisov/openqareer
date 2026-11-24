import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../data/sqliteBusyTimeout';
import { SealedText } from '../data/sealedText';
import type { LetterFactMark } from '../domain/letterFreshness';
import { TEXT_VARIANT_SCHEMA } from './sqliteTextVariantRepository';

/** Правка письма до одобрения: одна на вакансию. */
export interface StoredLetterDraft {
  readonly body: string;
  readonly variantId: string | null;
  readonly savedAt: string;
  readonly mark: LetterFactMark;
}

const KIND = 'letter_draft';
/** У таблицы вариантов обязательны место и пожелание; у правки письма место одно, пожелания нет. */
const POSITION = 1;
const NO_WISH = JSON.stringify({ chips: [], text: '' });

interface Row {
  id: string;
  text_cipher: string;
  payload_cipher: string | null;
  created_at: string;
}

/**
 * Черновик письма лежит в `text_variants` под своим видом: те же ключи и шифр, что у вариантов,
 * поэтому выгрузка и удаление данных кандидата уже его включают.
 */
export class SqliteLetterDraftRepository {
  private readonly sealedText: SealedText;

  constructor(
    private readonly database: DatabaseSync,
    encryptionKey: Buffer,
  ) {
    this.sealedText = new SealedText(encryptionKey);
    applySqliteBusyTimeout(database);
    database.exec(TEXT_VARIANT_SCHEMA);
  }

  private scope(candidateId: string, vacancyId: string, id: string): string {
    return `text-variant:${candidateId}:${KIND}:${vacancyId}:${id}`;
  }

  private row(candidateId: string, vacancyId: string): Row | undefined {
    return this.database
      .prepare(
        `SELECT id, text_cipher, payload_cipher, created_at FROM text_variants
         WHERE candidate_id = ? AND kind = ? AND subject_id = ? AND position = ?`,
      )
      .get(candidateId, KIND, vacancyId, POSITION) as Row | undefined;
  }

  /** Повреждённая строка — черновика нет: письмо открывается одобренным или собирается заново. */
  read(candidateId: string, vacancyId: string): StoredLetterDraft | null {
    const row = this.row(candidateId, vacancyId);
    if (!row?.payload_cipher) return null;
    try {
      const scope = this.scope(candidateId, vacancyId, row.id);
      const payload = JSON.parse(this.sealedText.open(row.payload_cipher, scope)) as Pick<
        StoredLetterDraft,
        'variantId' | 'mark'
      >;
      return {
        body: this.sealedText.open(row.text_cipher, scope),
        variantId: payload.variantId,
        savedAt: row.created_at,
        mark: payload.mark,
      };
    } catch {
      return null;
    }
  }

  save(candidateId: string, vacancyId: string, draft: StoredLetterDraft): void {
    const id = this.row(candidateId, vacancyId)?.id ?? randomUUID();
    const scope = this.scope(candidateId, vacancyId, id);
    const payload = JSON.stringify({ variantId: draft.variantId, mark: draft.mark });
    this.database
      .prepare(
        `INSERT INTO text_variants
           (id, candidate_id, kind, subject_id, position, text_cipher, payload_cipher, wish_cipher, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (candidate_id, kind, subject_id, position) DO UPDATE SET
           id = excluded.id, text_cipher = excluded.text_cipher, payload_cipher = excluded.payload_cipher,
           wish_cipher = excluded.wish_cipher, created_at = excluded.created_at`,
      )
      .run(
        id, candidateId, KIND, vacancyId, POSITION,
        this.sealedText.seal(draft.body, scope),
        this.sealedText.seal(payload, scope),
        this.sealedText.seal(NO_WISH, scope),
        draft.savedAt,
      );
  }

  remove(candidateId: string, vacancyId: string): void {
    this.database
      .prepare('DELETE FROM text_variants WHERE candidate_id = ? AND kind = ? AND subject_id = ?')
      .run(candidateId, KIND, vacancyId);
  }
}
