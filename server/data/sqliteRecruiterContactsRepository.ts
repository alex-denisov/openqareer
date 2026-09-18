import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { EmailStatus, RecruiterContact } from '../../shared/recruiterContact';

export const RECRUITER_CONTACTS_SCHEMA = `
CREATE TABLE IF NOT EXISTS recruiter_contacts (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL DEFAULT '',
  vacancy_id TEXT NOT NULL,
  company_name TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role_title TEXT NOT NULL,
  email TEXT,
  email_status TEXT NOT NULL CHECK (email_status IN ('verified', 'hypothesis', 'unverified')),
  phone TEXT,
  telegram TEXT,
  whatsapp TEXT,
  linkedin_url TEXT,
  github_url TEXT,
  twitter_url TEXT,
  source_type TEXT NOT NULL,
  confidence REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS idx_recruiter_contacts_vacancy ON recruiter_contacts(vacancy_id);
`;

const RECRUITER_CONTACTS_SCHEMA_WITH_FK = RECRUITER_CONTACTS_SCHEMA.replace(
  '  updated_at TEXT NOT NULL\n) STRICT;',
  '  updated_at TEXT NOT NULL,\n  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE CASCADE\n) STRICT;',
);

interface RecruiterContactRow {
  id: string;
  candidate_id: string;
  vacancy_id: string;
  company_name: string;
  full_name: string;
  role_title: string;
  email: string | null;
  email_status: EmailStatus;
  phone: string | null;
  telegram: string | null;
  whatsapp: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  twitter_url: string | null;
  source_type: string;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export type RecruiterContactsRepoOptions =
  | DatabaseSync
  | { databasePath: string };

function toContact(row: RecruiterContactRow): RecruiterContact {
  return {
    id: row.id,
    vacancyId: row.vacancy_id,
    companyName: row.company_name,
    fullName: row.full_name,
    roleTitle: row.role_title,
    email: row.email,
    emailStatus: row.email_status,
    phone: row.phone,
    telegram: row.telegram,
    whatsapp: row.whatsapp,
    linkedinUrl: row.linkedin_url,
    githubUrl: row.github_url,
    twitterUrl: row.twitter_url,
    sourceType: row.source_type,
    confidence: Number(row.confidence),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function contactToParams(contact: RecruiterContact, vacancyId: string): SQLInputValue[] {
  return [
    contact.id,
    vacancyId,
    contact.companyName,
    contact.fullName,
    contact.roleTitle,
    contact.email ?? null,
    contact.emailStatus,
    contact.phone ?? null,
    contact.telegram ?? null,
    contact.whatsapp ?? null,
    contact.linkedinUrl ?? null,
    contact.githubUrl ?? null,
    contact.twitterUrl ?? null,
    contact.sourceType,
    contact.confidence,
    contact.createdAt,
    contact.updatedAt,
  ];
}

export class SqliteRecruiterContactsRepository {
  private readonly database: DatabaseSync;

  constructor(options: RecruiterContactsRepoOptions) {
    if (options instanceof DatabaseSync) {
      this.database = options;
    } else {
      if (options.databasePath !== ':memory:') {
        mkdirSync(dirname(options.databasePath), { recursive: true });
      }
      this.database = new DatabaseSync(options.databasePath);
      this.database.exec('PRAGMA journal_mode = WAL;');
      this.database.exec('PRAGMA foreign_keys = ON;');
    }
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec(RECRUITER_CONTACTS_SCHEMA);
    const columns = this.database
      .prepare('PRAGMA table_info(recruiter_contacts)')
      .all() as unknown as Array<{ name: string }>;
    if (!columns.some((column) => column.name === 'candidate_id')) {
      this.database.exec(
        "ALTER TABLE recruiter_contacts ADD COLUMN candidate_id TEXT NOT NULL DEFAULT ''",
      );
    }
    this.ensureCandidateForeignKey();
  }

  private ensureCandidateForeignKey(): void {
    const hasCandidates = this.database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'candidates'")
      .get() !== undefined;
    if (!hasCandidates) return;
    const tableSql = this.database
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'recruiter_contacts'")
      .get() as { sql?: string } | undefined;
    if (tableSql?.sql?.includes('REFERENCES candidates')) return;

    this.database.exec('DROP INDEX IF EXISTS idx_recruiter_contacts_vacancy');
    this.database.exec('ALTER TABLE recruiter_contacts RENAME TO recruiter_contacts_legacy_fk');
    this.database.exec(RECRUITER_CONTACTS_SCHEMA_WITH_FK);
    this.database.exec(`
      INSERT INTO recruiter_contacts (
        id, candidate_id, vacancy_id, company_name, full_name, role_title,
        email, email_status, phone, telegram, whatsapp,
        linkedin_url, github_url, twitter_url, source_type,
        confidence, created_at, updated_at
      )
      SELECT old.id, old.candidate_id, old.vacancy_id, old.company_name,
        old.full_name, old.role_title, old.email, old.email_status, old.phone,
        old.telegram, old.whatsapp, old.linkedin_url, old.github_url,
        old.twitter_url, old.source_type, old.confidence, old.created_at,
        old.updated_at
      FROM recruiter_contacts_legacy_fk old
      WHERE EXISTS (SELECT 1 FROM candidates c WHERE c.id = old.candidate_id)
    `);
    this.database.exec('DROP TABLE recruiter_contacts_legacy_fk');
  }

  saveContacts(candidateId: string, vacancyId: string, contacts: RecruiterContact[]): void;
  saveContacts(vacancyId: string, contacts: RecruiterContact[]): void;
  saveContacts(
    candidateIdOrVacancyId: string,
    vacancyIdOrContacts: string | RecruiterContact[],
    maybeContacts?: RecruiterContact[],
  ): void {
    const scoped = maybeContacts !== undefined;
    const candidateId = scoped ? candidateIdOrVacancyId : '';
    const vacancyId = scoped ? String(vacancyIdOrContacts) : candidateIdOrVacancyId;
    const contacts = (maybeContacts ?? vacancyIdOrContacts) as RecruiterContact[];
    const deleteStmt = this.database.prepare(
      'DELETE FROM recruiter_contacts WHERE candidate_id = ? AND vacancy_id = ?',
    );
    const insertStmt = this.database.prepare(`
      INSERT INTO recruiter_contacts (
        id, candidate_id, vacancy_id, company_name, full_name, role_title,
        email, email_status, phone, telegram, whatsapp,
        linkedin_url, github_url, twitter_url, source_type,
        confidence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.database.exec('BEGIN TRANSACTION');
    try {
        deleteStmt.run(candidateId, vacancyId);
      for (const contact of contacts) {
        insertStmt.run(contact.id, candidateId, ...contactToParams(contact, vacancyId).slice(1));
      }
      this.database.exec('COMMIT');
    } catch (err) {
      this.database.exec('ROLLBACK');
      throw err;
    }
  }

  getContactsByVacancyId(candidateId: string, vacancyId: string): RecruiterContact[];
  getContactsByVacancyId(vacancyId: string): RecruiterContact[];
  getContactsByVacancyId(candidateIdOrVacancyId: string, maybeVacancyId?: string): RecruiterContact[] {
    const scoped = maybeVacancyId !== undefined;
    const candidateId = scoped ? candidateIdOrVacancyId : '';
    const vacancyId = maybeVacancyId ?? candidateIdOrVacancyId;
    const stmt = this.database.prepare(`
      SELECT
        id, candidate_id, vacancy_id, company_name, full_name, role_title,
        email, email_status, phone, telegram, whatsapp,
        linkedin_url, github_url, twitter_url, source_type,
        confidence, created_at, updated_at
      FROM recruiter_contacts
      WHERE candidate_id = ? AND vacancy_id = ?
      ORDER BY confidence DESC, created_at ASC
    `);
    const rows = stmt.all(candidateId, vacancyId) as unknown as RecruiterContactRow[];
    return rows.map(toContact);
  }

  deleteContactsByVacancyId(candidateId: string, vacancyId: string): void;
  deleteContactsByVacancyId(vacancyId: string): void;
  deleteContactsByVacancyId(candidateIdOrVacancyId: string, maybeVacancyId?: string): void {
    const scoped = maybeVacancyId !== undefined;
    const candidateId = scoped ? candidateIdOrVacancyId : '';
    const vacancyId = maybeVacancyId ?? candidateIdOrVacancyId;
    this.database
      .prepare('DELETE FROM recruiter_contacts WHERE candidate_id = ? AND vacancy_id = ?')
      .run(candidateId, vacancyId);
  }

  deleteContactsByCandidateId(candidateId: string): number {
    return Number(
      this.database.prepare('DELETE FROM recruiter_contacts WHERE candidate_id = ?').run(candidateId).changes,
    );
  }

  close(): void {
    this.database.close();
  }
}
