import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { B640ContactMessageKind, B640ContactMessageState } from '../../shared/b640ContactMessage';
import { CANDIDATE_CONTACT_MESSAGES_TABLE } from './contactMessageSchema';
import { applySqliteBusyTimeout } from './sqliteBusyTimeout';

export interface StoredContactMessage {
  readonly id: string;
  readonly candidateId: string;
  readonly contactId: string | null;
  readonly recruiterId: string | null;
  readonly vacancyId: string | null;
  readonly kind: B640ContactMessageKind;
  readonly text: string;
  readonly recipientName: string;
  readonly recipientUrl: string | null;
  readonly state: B640ContactMessageState;
  readonly createdAt: string;
  readonly approvedAt: string | null;
  readonly sentAt: string | null;
}

export type NewContactMessage = Omit<StoredContactMessage, 'state' | 'approvedAt' | 'sentAt'>;

export type OpenDraftKey = Pick<
  StoredContactMessage,
  'candidateId' | 'contactId' | 'recruiterId' | 'vacancyId' | 'kind' | 'recipientName' | 'recipientUrl'
>;

interface Row {
  id: string;
  candidate_id: string;
  contact_id: string | null;
  recruiter_id: string | null;
  vacancy_id: string | null;
  kind: B640ContactMessageKind;
  text: string;
  recipient_name: string;
  recipient_url: string | null;
  state: B640ContactMessageState;
  created_at: string;
  approved_at: string | null;
  sent_at: string | null;
}

const toMessage = (row: Row): StoredContactMessage => ({
  id: row.id,
  candidateId: row.candidate_id,
  contactId: row.contact_id,
  recruiterId: row.recruiter_id,
  vacancyId: row.vacancy_id,
  kind: row.kind,
  text: row.text,
  recipientName: row.recipient_name,
  recipientUrl: row.recipient_url,
  state: row.state,
  createdAt: row.created_at,
  approvedAt: row.approved_at,
  sentAt: row.sent_at,
});

/** B698: черновики, одобрение и отметка «Отправил»; все чтения и записи в границах кандидата. */
export class SqliteContactMessageRepository {
  private readonly database: DatabaseSync;

  constructor(options: { databasePath: string }) {
    if (options.databasePath !== ':memory:') {
      mkdirSync(dirname(options.databasePath), { recursive: true, mode: 0o700 });
    }
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    applySqliteBusyTimeout(this.database);
    this.database.exec(CANDIDATE_CONTACT_MESSAGES_TABLE);
  }

  create(message: NewContactMessage): StoredContactMessage {
    this.database
      .prepare(
        `INSERT INTO candidate_contact_messages
           (id, candidate_id, contact_id, recruiter_id, vacancy_id, kind, text, recipient_name, recipient_url, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      )
      .run(message.id, message.candidateId, message.contactId, message.recruiterId, message.vacancyId,
        message.kind, message.text, message.recipientName, message.recipientUrl, message.createdAt);
    return { ...message, state: 'draft', approvedAt: null, sentAt: null };
  }

  /** B682: неотправленный черновик тому же получателю по той же вакансии; свежий первым. */
  findOpen(key: OpenDraftKey): StoredContactMessage | null {
    const row = this.database
      .prepare(
        `SELECT * FROM candidate_contact_messages
         WHERE candidate_id = ? AND contact_id IS ? AND recruiter_id IS ? AND vacancy_id IS ? AND kind = ?
           AND recipient_name = ? AND recipient_url IS ? AND state != 'sent'
         ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      )
      .get(key.candidateId, key.contactId, key.recruiterId, key.vacancyId, key.kind,
        key.recipientName, key.recipientUrl) as Row | undefined;
    return row ? toMessage(row) : null;
  }

  get(candidateId: string, id: string): StoredContactMessage | null {
    const row = this.database
      .prepare('SELECT * FROM candidate_contact_messages WHERE candidate_id = ? AND id = ?')
      .get(candidateId, id) as Row | undefined;
    return row ? toMessage(row) : null;
  }

  listForContact(candidateId: string, contactId: string, limit: number): StoredContactMessage[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM candidate_contact_messages WHERE candidate_id = ? AND contact_id = ?
         ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(candidateId, contactId, limit) as unknown as Row[];
    return rows.map(toMessage);
  }

  /** B796: ещё не отправленные — их текст пересобирается после исправления факта. */
  listUnsent(candidateId: string): StoredContactMessage[] {
    const rows = this.database
      .prepare(`SELECT * FROM candidate_contact_messages WHERE candidate_id = ? AND state != 'sent'`)
      .all(candidateId) as unknown as Row[];
    return rows.map(toMessage);
  }

  /** Отправленные по вакансии, свежие сверху: «Что было» в отклике. */
  listSentForVacancy(candidateId: string, vacancyId: string, limit: number): StoredContactMessage[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM candidate_contact_messages
         WHERE candidate_id = ? AND vacancy_id = ? AND state = 'sent' AND sent_at IS NOT NULL
         ORDER BY sent_at DESC, rowid DESC LIMIT ?`,
      )
      .all(candidateId, vacancyId, limit) as unknown as Row[];
    return rows.map(toMessage);
  }

  /** Правка до отправки; одобрение сбрасывается, потому что текст изменился. */
  updateText(candidateId: string, id: string, text: string): boolean {
    return this.database
      .prepare(
        `UPDATE candidate_contact_messages SET text = ?, state = 'draft', approved_at = NULL
         WHERE candidate_id = ? AND id = ? AND state != 'sent'`,
      )
      .run(text, candidateId, id).changes === 1;
  }

  approve(candidateId: string, id: string, now: string): boolean {
    return this.database
      .prepare(
        `UPDATE candidate_contact_messages SET state = 'approved', approved_at = ?
         WHERE candidate_id = ? AND id = ? AND state IN ('draft', 'approved')`,
      )
      .run(now, candidateId, id).changes === 1;
  }

  markSent(candidateId: string, id: string, now: string): boolean {
    return this.database
      .prepare(
        `UPDATE candidate_contact_messages SET state = 'sent', sent_at = ?
         WHERE candidate_id = ? AND id = ? AND state = 'approved'`,
      )
      .run(now, candidateId, id).changes === 1;
  }

  /** «Не отправлять»: неотправленный черновик удаляется. */
  discard(candidateId: string, id: string): boolean {
    return this.database
      .prepare(`DELETE FROM candidate_contact_messages WHERE candidate_id = ? AND id = ? AND state != 'sent'`)
      .run(candidateId, id).changes === 1;
  }

  close(): void {
    this.database.close();
  }
}
