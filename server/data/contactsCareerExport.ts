import type { DatabaseSync } from 'node:sqlite';
import type { CandidateRecruiterChannel } from '../../shared/recruiterChannel';
import type { RecruiterContact } from '../../shared/recruiterContact';
import { type CandidateIncome, SqliteCandidateIncomeRepository } from '../candidate/sqliteCandidateIncomeRepository';
import { type SavedRelocationPlaces, SqliteRelocationPlacesRepository } from '../candidate/sqliteRelocationPlacesRepository';
import { tableExists } from './exportTableReader';
import { type CandidateCompanyWant, SqliteCandidateCompanyWantsRepository } from './sqliteCandidateCompanyWantsRepository';
import { SqliteRecruiterContactsRepository } from './sqliteRecruiterContactsRepository';

/**
 * B738 · 5–6: контакты рекрутёров и переписка с ними, карьерные разделы кабинета и вакансии,
 * найденные подпиской. Контакт отдаётся так, как его видит кандидат: без источника, уверенности,
 * квитанции и страницы, где найден канал (решение владельца 23.09: механику поиска не показываем).
 */
export interface ContactsCareerSources {
  readonly database: DatabaseSync;
  readonly encryptionKey: Buffer;
}

type Row = Record<string, unknown>;

export type ExportedRecruiterContact = Omit<RecruiterContact, 'sourceType' | 'confidence' | 'sourceReceipt' | 'channels'> & {
  readonly channels: readonly CandidateRecruiterChannel[];
};

export interface ContactsExport {
  readonly recruiters: readonly ExportedRecruiterContact[];
  readonly messages: readonly Row[];
  readonly statuses: readonly Row[];
}

export interface CareerSectionsExport {
  readonly companyWants: readonly CandidateCompanyWant[];
  readonly dismissedCompanyProposals: readonly string[];
  readonly growthGoals: readonly Row[];
  readonly income: CandidateIncome | null;
  readonly professionPath: readonly Row[];
  readonly relocationPlaces: SavedRelocationPlaces | null;
  readonly subscriptionVacancies: readonly Row[];
}

function rows(database: DatabaseSync, table: string, sql: string, candidateId: string): Row[] {
  if (!tableExists(database, table)) return [];
  return database.prepare(sql).all(candidateId) as Row[];
}

function toExportedContact(contact: RecruiterContact): ExportedRecruiterContact {
  const { sourceType: _source, confidence: _confidence, sourceReceipt: _receipt, channels, ...shown } = contact;
  return { ...shown, channels: (channels ?? []).map(({ sourceUrl: _url, ...channel }) => channel) };
}

export function exportContacts(sources: ContactsCareerSources, candidateId: string): ContactsExport {
  const { database } = sources;
  const recruiters = tableExists(database, 'recruiter_contacts')
    ? new SqliteRecruiterContactsRepository(database).listContactsByCandidateId(candidateId).map(toExportedContact)
    : [];
  return {
    recruiters,
    messages: rows(
      database,
      'candidate_contact_messages',
      `SELECT id, contact_id AS contactId, recruiter_id AS recruiterId, vacancy_id AS vacancyId, kind, text,
         recipient_name AS recipientName, recipient_url AS recipientUrl, state,
         created_at AS createdAt, approved_at AS approvedAt, sent_at AS sentAt
       FROM candidate_contact_messages WHERE candidate_id = ? ORDER BY created_at, id`,
      candidateId,
    ),
    statuses: rows(
      database,
      'candidate_contact_status',
      'SELECT contact_id AS contactId, state, at FROM candidate_contact_status WHERE candidate_id = ? ORDER BY at, contact_id',
      candidateId,
    ),
  };
}

function companyWants(sources: ContactsCareerSources, candidateId: string) {
  if (!tableExists(sources.database, 'candidate_company_wants')) return { wants: [], dismissed: [] };
  const repository = new SqliteCandidateCompanyWantsRepository(sources.database, sources.encryptionKey);
  return { wants: repository.list(candidateId), dismissed: [...repository.listDismissedContactProposals(candidateId)].sort() };
}

export function exportCareerSections(sources: ContactsCareerSources, candidateId: string): CareerSectionsExport {
  const { database, encryptionKey } = sources;
  const { wants, dismissed } = companyWants(sources, candidateId);
  const incomeStored = rows(database, 'candidate_income', 'SELECT 1 FROM candidate_income WHERE candidate_id = ?', candidateId).length > 0;
  const placesStored = rows(database, 'candidate_relocation_places', 'SELECT 1 FROM candidate_relocation_places WHERE candidate_id = ?', candidateId).length > 0;
  return {
    companyWants: wants,
    dismissedCompanyProposals: dismissed,
    growthGoals: rows(
      database,
      'candidate_growth_goals',
      'SELECT workplace_id AS workplaceId, kind, chosen_at AS chosenAt FROM candidate_growth_goals WHERE candidate_id = ? ORDER BY chosen_at, id',
      candidateId,
    ),
    income: incomeStored ? new SqliteCandidateIncomeRepository(database, encryptionKey).get(candidateId) : null,
    professionPath: rows(
      database,
      'candidate_profession_path',
      'SELECT target_key AS targetKey, lower_income AS lowerIncome, updated_at AS updatedAt FROM candidate_profession_path WHERE candidate_id = ?',
      candidateId,
    ),
    relocationPlaces: placesStored ? new SqliteRelocationPlacesRepository(database).read(candidateId) : null,
    subscriptionVacancies: rows(
      database,
      'vacancy_subscription_items',
      `SELECT links.subscription_id AS subscriptionId, vacancies.source, vacancies.canonical_url AS url,
         links.first_matched_at AS firstMatchedAt, links.last_matched_at AS lastMatchedAt
       FROM vacancy_subscription_items AS links
       JOIN vacancy_subscriptions AS subscriptions ON subscriptions.id = links.subscription_id
       JOIN vacancies ON vacancies.id = links.vacancy_id
       WHERE subscriptions.candidate_id = ? ORDER BY links.first_matched_at, links.vacancy_id`,
      candidateId,
    ),
  };
}
