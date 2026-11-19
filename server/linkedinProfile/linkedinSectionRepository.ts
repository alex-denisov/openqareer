import type { DatabaseSync } from 'node:sqlite';
import { LINKEDIN_SECTION_CASCADE, LINKEDIN_SECTION_TABLES } from '../data/linkedinSectionsSchema';

/**
 * B692/B645: отметки «Выполнено» и варианты «Предложить заново» по ключу предложения
 * (`headline`, `about`, `skills`, `experience:<id>`). Только наша база, наружу ничего не уходит.
 * «Выполнено» лежит в `pasted_at` таблицы отметок B692: это та же отметка «вставлено в LinkedIn».
 */
export class LinkedinSectionRepository {
  constructor(private readonly database: DatabaseSync, private readonly clock: () => number = Date.now) {
    database.exec(LINKEDIN_SECTION_TABLES);
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidates'").get()) {
      database.exec(LINKEDIN_SECTION_CASCADE);
    }
  }

  private now(): string {
    return new Date(this.clock()).toISOString();
  }

  getDone(candidateId: string): Map<string, string> {
    const rows = this.database
      .prepare('SELECT section, pasted_at FROM candidate_linkedin_section_events WHERE candidate_id = ? AND pasted_at IS NOT NULL')
      .all(candidateId) as unknown as { section: string; pasted_at: string }[];
    return new Map(rows.map((row) => [row.section, row.pasted_at]));
  }

  /** Отмечает «Выполнено»; уже отмеченное сохраняет свою дату. */
  markDone(candidateId: string, keys: readonly string[]): Map<string, string> {
    const now = this.now();
    const insert = this.database.prepare(`INSERT INTO candidate_linkedin_section_events (candidate_id, section, pasted_at)
      VALUES (?, ?, ?) ON CONFLICT(candidate_id, section) DO UPDATE SET pasted_at = COALESCE(pasted_at, excluded.pasted_at)`);
    for (const key of keys) insert.run(candidateId, key, now);
    const done = this.getDone(candidateId);
    return new Map(keys.flatMap((key) => (done.has(key) ? [[key, done.get(key)!] as const] : [])));
  }

  /** Варианты по ключам, в порядке появления. */
  getVariants(candidateId: string): Map<string, string[]> {
    const rows = this.database
      .prepare('SELECT offer_key, text FROM candidate_linkedin_offer_variants WHERE candidate_id = ? ORDER BY offer_key, position')
      .all(candidateId) as unknown as { offer_key: string; text: string }[];
    const variants = new Map<string, string[]>();
    for (const row of rows) variants.set(row.offer_key, [...(variants.get(row.offer_key) ?? []), row.text]);
    return variants;
  }

  /**
   * Новый вариант становится предложением; прежняя отметка «Выполнено» к нему не относится.
   * Потолок проверяется в самой вставке: `false` — вариантов уже `max`.
   */
  addVariant(candidateId: string, key: string, text: string, max: number): boolean {
    const inserted = this.database.prepare(`INSERT INTO candidate_linkedin_offer_variants (candidate_id, offer_key, position, text, created_at)
      SELECT ?, ?, COUNT(*) + 1, ?, ? FROM candidate_linkedin_offer_variants WHERE candidate_id = ? AND offer_key = ?
      HAVING COUNT(*) < ?`).run(candidateId, key, text, this.now(), candidateId, key, max);
    if (Number(inserted.changes) === 0) return false;
    this.database
      .prepare('UPDATE candidate_linkedin_section_events SET pasted_at = NULL WHERE candidate_id = ? AND section = ?')
      .run(candidateId, key);
    return true;
  }
}
