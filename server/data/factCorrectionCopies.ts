import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { FactCorrectionChange, FactCorrectionTarget } from '../../shared/factCorrection';
import { SqliteResumeEditChoicesRepository } from '../candidate/sqliteResumeEditChoicesRepository';
import { SqliteTextVariantRepository, type TextSubject } from '../candidate/sqliteTextVariantRepository';
import { correctedCopy, suggestedCopy, type NumberChange } from '../domain/factCorrection';
import { copyPlace } from '../domain/factCorrectionProposals';
import type { SealedText } from './sealedText';
import { SqliteContactMessageRepository, type StoredContactMessage } from './sqliteContactMessageRepository';

/**
 * B796: копии факта вне профиля, ещё не отправленные: правки резюме под вакансию, сообщения, варианты
 * текстов. Пишутся в транзакции правки и записаны в журнал, по нему их возвращает «Отменить».
 */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS candidate_fact_corrections (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  payload_cipher TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;
`;

interface EditChange {
  readonly vacancyId: string;
  readonly texts: ReadonlyArray<{ readonly id: string; readonly before: string; readonly after: string }>;
  readonly translations: Readonly<Record<string, string>>;
}

interface MessageChange {
  readonly id: string;
  readonly after: string;
  readonly was: Pick<StoredContactMessage, 'text' | 'state' | 'approvedAt'>;
}

interface Journal {
  readonly changes: readonly FactCorrectionChange[];
  readonly edits: readonly EditChange[];
  readonly messages: readonly MessageChange[];
}

interface Corrected {
  readonly target: FactCorrectionTarget;
  readonly placeKey: string | null;
  readonly numbers: readonly NumberChange[];
}

export interface CopyCounts {
  readonly id: string;
  readonly resetMessages: number;
  readonly staleVariants: number;
}

const tableExists = (database: DatabaseSync, name: string): boolean =>
  database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;

/** Вакансии, куда отклик уже ушёл или уходит: их правки и варианты — то, что видел работодатель. */
function sentVacancies(database: DatabaseSync, candidateId: string): ReadonlySet<string> {
  const queries: readonly (readonly [string, string])[] = [
    ['applications', "SELECT cluster_id AS id FROM applications WHERE candidate_id = ? AND stage != 'saved' AND cluster_id IS NOT NULL"],
    ['hh_apply_attempt_cards', `SELECT c.card_id AS id FROM hh_apply_attempts a
       JOIN hh_apply_attempt_cards c ON c.attempt_id = a.id
       WHERE a.candidate_id = ? AND (a.outcome IS NULL OR a.outcome = 'sent')`],
  ];
  return new Set(
    queries.flatMap(([table, sql]) =>
      tableExists(database, table)
        ? (database.prepare(sql).all(candidateId) as Array<{ id: string }>).map(({ id }) => id)
        : []),
  );
}

export class FactCorrectionCopies {
  private readonly edits: SqliteResumeEditChoicesRepository;
  private readonly variants: SqliteTextVariantRepository;
  private readonly messages: SqliteContactMessageRepository;

  constructor(
    private readonly database: DatabaseSync,
    private readonly sealed: SealedText,
  ) {
    this.edits = new SqliteResumeEditChoicesRepository(database, sealed);
    this.variants = new SqliteTextVariantRepository(database, sealed);
    this.messages = new SqliteContactMessageRepository(database);
    database.exec(SCHEMA);
  }

  /** Приводит неотправленное к новому факту и запоминает прежнее. */
  apply(candidateId: string, changes: readonly FactCorrectionChange[], fact: Corrected): CopyCounts {
    const id = randomUUID();
    const sent = sentVacancies(this.database, candidateId);
    const edits = this.applyEdits(candidateId, fact, sent);
    const messages = this.applyMessages(candidateId, fact.numbers);
    const staleVariants = this.variants.markStale(
      candidateId,
      id,
      (text) => suggestedCopy(text, fact.numbers) !== null,
      (subject, payload) => this.isSent(subject, payload, sent),
    );
    this.database
      .prepare('INSERT INTO candidate_fact_corrections (id, candidate_id, payload_cipher, created_at) VALUES (?, ?, ?, ?)')
      .run(id, candidateId, this.seal(candidateId, id, { changes, edits, messages }), new Date().toISOString());
    return { id, resetMessages: messages.length, staleVariants };
  }

  /** Записанная правка; `null` — её нет или она уже отменена. */
  changesOf(candidateId: string, id: string): readonly FactCorrectionChange[] | null {
    return this.read(candidateId, id)?.changes ?? null;
  }

  /** Возвращает то, что с тех пор не изменено и не отправлено. */
  revert(candidateId: string, id: string): void {
    const journal = this.read(candidateId, id);
    if (!journal) return;
    const sent = sentVacancies(this.database, candidateId);
    for (const edit of journal.edits) if (!sent.has(edit.vacancyId)) this.revertEdit(candidateId, edit);
    for (const { id: messageId, after, was } of journal.messages) {
      if (this.messages.get(candidateId, messageId)?.text === after)
        this.messages.restoreText(candidateId, messageId, was);
    }
    this.variants.unmarkStale(id);
    this.database.prepare('DELETE FROM candidate_fact_corrections WHERE id = ?').run(id);
  }

  /** Текст уже у работодателя или в LinkedIn. Вариант пункта резюме без вакансии никуда не ушёл. */
  private isSent({ candidateId, kind, subjectId }: TextSubject, payload: unknown, sent: ReadonlySet<string>): boolean {
    if (kind === 'letter') return sent.has(subjectId);
    if (kind === 'resume') {
      const vacancyId = (payload as { vacancyId?: unknown } | null)?.vacancyId;
      return typeof vacancyId === 'string' && sent.has(vacancyId);
    }
    if (kind === 'post' || kind === 'comment') return this.isPublished(candidateId, subjectId);
    return kind === 'message' && this.messages.get(candidateId, subjectId)?.state === 'sent';
  }

  /** Опубликован или уже скопирован для LinkedIn. */
  private isPublished(candidateId: string, draftId: string): boolean {
    const queries: readonly (readonly [string, string])[] = [
      ['candidate_linkedin_queue', "SELECT 1 FROM candidate_linkedin_queue WHERE candidate_id = ? AND draft_id = ? AND state = 'done'"],
      ['candidate_drafts', "SELECT 1 FROM candidate_drafts WHERE candidate_id = ? AND id = ? AND status = 'copied'"],
    ];
    return queries.some(([table, sql]) =>
      tableExists(this.database, table) && this.database.prepare(sql).get(candidateId, draftId) !== undefined);
  }

  private applyEdits(candidateId: string, fact: Corrected, sent: ReadonlySet<string>): EditChange[] {
    const own = fact.target.kind === 'memory' ? fact.target.id : null;
    const fixed = (id: string, text: string) => {
      const [placeKey = '', memoryId] = id.split(':');
      const next = correctedCopy(text, fact.numbers, copyPlace(fact.placeKey, placeKey));
      return next ?? (own !== null && memoryId === own ? suggestedCopy(text, fact.numbers) : null);
    };
    const isStale = (text: string) => suggestedCopy(text, fact.numbers) !== null;
    return this.edits.list(candidateId).flatMap(({ vacancyId, choices }): EditChange[] => {
      if (sent.has(vacancyId)) return [];
      const texts = Object.entries(choices.texts).flatMap(([id, before]) => {
        const after = fixed(id, before);
        return after === null ? [] : [{ id, before, after }];
      });
      const all = Object.entries(choices.translations ?? {});
      const removed = all.filter(([key, value]) => isStale(key) || isStale(value));
      if (texts.length === 0 && removed.length === 0) return [];
      const next = {
        ...choices,
        texts: { ...choices.texts, ...Object.fromEntries(texts.map(({ id, after }) => [id, after])) },
        ...(choices.translations
          ? { translations: Object.fromEntries(all.filter((entry) => !removed.includes(entry))) }
          : {}),
      };
      this.edits.save(candidateId, vacancyId, next, new Date().toISOString());
      return [{ vacancyId, texts, translations: Object.fromEntries(removed) }];
    });
  }

  private revertEdit(candidateId: string, { vacancyId, texts, translations }: EditChange): void {
    const choices = this.edits.read(candidateId, vacancyId);
    const back = texts.flatMap(({ id, before, after }) => (choices.texts[id] === after ? [[id, before]] : []));
    const next = {
      ...choices,
      texts: { ...choices.texts, ...Object.fromEntries(back) },
      ...(Object.keys(translations).length > 0
        ? { translations: { ...translations, ...choices.translations } }
        : {}),
    };
    this.edits.save(candidateId, vacancyId, next, new Date().toISOString());
  }

  /** Тот же факт исправляется; похожий текст остаётся, но снова ждёт одобрения. */
  private applyMessages(candidateId: string, numbers: readonly NumberChange[]): MessageChange[] {
    return this.messages.listUnsent(candidateId).flatMap(({ id, text, state, approvedAt }) => {
      const fixed = correctedCopy(text, numbers);
      const after = fixed ?? (suggestedCopy(text, numbers) === null ? null : text);
      if (after === null || !this.messages.updateText(candidateId, id, after)) return [];
      return [{ id, after, was: { text, state, approvedAt } }];
    });
  }

  private scope(candidateId: string, id: string): string {
    return `fact-correction:${candidateId}:${id}`;
  }

  private seal(candidateId: string, id: string, journal: Journal): string {
    return this.sealed.seal(JSON.stringify(journal), this.scope(candidateId, id));
  }

  private read(candidateId: string, id: string): Journal | null {
    const row = this.database
      .prepare('SELECT payload_cipher FROM candidate_fact_corrections WHERE candidate_id = ? AND id = ?')
      .get(candidateId, id) as { payload_cipher: string } | undefined;
    return row ? (JSON.parse(this.sealed.open(row.payload_cipher, this.scope(candidateId, id))) as Journal) : null;
  }
}
