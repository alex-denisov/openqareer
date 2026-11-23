import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { RecruiterContact } from '../../shared/recruiterContact';
import { SqliteCandidateIncomeRepository } from '../candidate/sqliteCandidateIncomeRepository';
import { SqliteGrowthGoalRepository } from '../candidate/sqliteGrowthGoalRepository';
import { SqliteProfessionPathRepository } from '../candidate/sqliteProfessionPathRepository';
import { SqliteRelocationPlacesRepository } from '../candidate/sqliteRelocationPlacesRepository';
import { SqliteResumePhotoRepository } from '../candidate/sqliteResumePhotoRepository';
import { CANDIDATE_CONTACT_MESSAGES_TABLE } from './contactMessageSchema';
import { CANDIDATE_CONTACT_STATUS_TABLE } from './contactStatusSchema';
import { forbiddenExportKeys } from './exportForbiddenKeys';
import { SqliteCandidateCompanyWantsRepository } from './sqliteCandidateCompanyWantsRepository';
import { SqliteRecruiterContactsRepository } from './sqliteRecruiterContactsRepository';
import { createCandidate, createStore, directories } from './sqliteTestHarness';

const AT = '2026-11-23T10:00:00.000Z';
const KEY = Buffer.alloc(32, 4);

function fileStore() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-contacts-export-'));
  directories.push(directory);
  const databasePath = join(directory, 'candidate.sqlite');
  return { databasePath, store: createStore(databasePath) };
}

function contact(tag: string): RecruiterContact {
  return {
    id: `contact-${tag}`, vacancyId: `vacancy-${tag}`, companyName: `Компания ${tag}`, fullName: `Рекрутер ${tag}`,
    roleTitle: 'HR', email: `${tag}@example.test`, emailStatus: 'verified', phone: null, telegram: null, whatsapp: null,
    linkedinUrl: null, githubUrl: null, twitterUrl: null, sourceType: 'osint-tool', confidence: 0.9,
    sourceReceipt: { receiptId: 'r', source: 'internal-tool', method: 'smtp', observedAt: AT, confidence: 0.9 },
    channels: [{ kind: 'email_corporate', value: `${tag}@example.test`, href: null, status: 'verified', sourceUrl: 'https://internal.test/page', observedAt: AT }],
    createdAt: AT, updatedAt: AT,
  };
}

function seed(database: DatabaseSync, candidateId: string, tag: string) {
  new SqliteRecruiterContactsRepository(database).saveContacts(candidateId, `vacancy-${tag}`, [contact(tag)]);
  database.exec(CANDIDATE_CONTACT_MESSAGES_TABLE + CANDIDATE_CONTACT_STATUS_TABLE);
  database.prepare(`INSERT INTO candidate_contact_messages(id,candidate_id,contact_id,kind,text,recipient_name,state,created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(`message-${tag}`, candidateId, `contact-${tag}`, 'intro', `Здравствуйте, ${tag}`, `Рекрутер ${tag}`, 'draft', AT);
  database.prepare('INSERT INTO candidate_contact_status VALUES (?,?,?,?)').run(candidateId, `contact-${tag}`, 'wrote', AT);
  const wants = new SqliteCandidateCompanyWantsRepository(database, KEY);
  wants.setWanted(candidateId, `company-${tag}`, `Компания ${tag}`, AT);
  wants.dismissContactProposal(candidateId, `other-${tag}`, AT);
  new SqliteGrowthGoalRepository(database).choose(candidateId, `work-${tag}`, 'promotion', AT);
  new SqliteCandidateIncomeRepository(database, KEY).put(candidateId, { current: 300000, expected: 400000 }, AT);
  new SqliteProfessionPathRepository(database).putLowerIncome(candidateId, `target-${tag}`, 'yes', AT);
  new SqliteResumePhotoRepository(database).setInResume(candidateId, tag !== 'свой', AT);
  new SqliteRelocationPlacesRepository(database).replace(candidateId, [{ kind: 'country', code: 'DE', skipped: [] }], AT);
}

describe('B738 · 5–6: контакты, переписка и карьерные разделы в выгрузке', () => {
  it('свои строки всех таблиц, контакт без механики поиска, чужого нет', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const other = createCandidate(store);
    const database = new DatabaseSync(databasePath);
    seed(database, own.id, 'свой');
    seed(database, other.id, 'чужой');
    for (const [candidateId, tag] of [[own.id, 'own'], [other.id, 'other']] as const) {
      const subscription = store.createVacancySubscription(candidateId, { source: 'hh', query: 'CTO', cadenceMinutes: 360 }, AT);
      database.prepare('INSERT INTO vacancies(id,source,external_id,canonical_url,first_seen_at,last_seen_at,latest_version) VALUES (?,?,?,?,?,?,1)')
        .run(`vacancy-row-${tag}`, 'hh', `ext-${tag}`, `https://hh.ru/vacancy/${tag}`, AT, AT);
      database.prepare('INSERT INTO vacancy_subscription_items VALUES (?,?,?,?)').run(subscription.id, `vacancy-row-${tag}`, AT, AT);
    }
    database.close();

    const exported = store.exportCandidate(own.id);
    const [recruiter] = exported.contacts.recruiters;
    expect(recruiter).toMatchObject({ id: 'contact-свой', fullName: 'Рекрутер свой', email: 'свой@example.test' });
    expect(recruiter!.channels).toEqual([{ kind: 'email_corporate', value: 'свой@example.test', href: null, status: 'verified', observedAt: AT }]);
    expect(Object.keys(recruiter!)).not.toEqual(expect.arrayContaining(['sourceType']));
    expect(JSON.stringify(exported.contacts)).not.toMatch(/osint-tool|internal-tool|internal\.test|confidence|sourceReceipt/u);
    expect(exported.contacts.messages).toEqual([expect.objectContaining({ id: 'message-свой', text: 'Здравствуйте, свой', state: 'draft' })]);
    expect(exported.contacts.statuses).toEqual([{ contactId: 'contact-свой', state: 'wrote', at: AT }]);
    const career = exported.careerSections;
    expect(career.companyWants).toEqual([expect.objectContaining({ companyKey: 'company-свой', companyName: 'Компания свой' })]);
    expect(career.dismissedCompanyProposals).toEqual(['other-свой']);
    expect(career.growthGoals).toEqual([{ workplaceId: 'work-свой', kind: 'promotion', chosenAt: AT }]);
    expect(career.income).toEqual({ current: 300000, expected: 400000 });
    expect(career.resumePhotoInResume).toBe(false);
    expect(career.professionPath).toEqual([{ targetKey: 'target-свой', lowerIncome: 'yes', updatedAt: AT }]);
    expect(career.relocationPlaces).toMatchObject({ saved: true, places: [{ kind: 'country', code: 'DE', skipped: [] }] });
    expect(career.subscriptionVacancies).toEqual([expect.objectContaining({ source: 'hh', url: 'https://hh.ru/vacancy/own', firstMatchedAt: AT })]);
    const both = JSON.stringify({ contacts: exported.contacts, career });
    expect(both).not.toContain('чужой');
    expect(both).not.toContain('vacancy/other');
    expect(forbiddenExportKeys({ contacts: exported.contacts, career })).toEqual([]);
  });

  it('без таблиц разделы пустые и схема не меняется', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const tables = () => new DatabaseSync(databasePath).prepare("SELECT group_concat(name) AS names FROM (SELECT name FROM sqlite_master WHERE type='table' ORDER BY name)").get();
    const before = tables();
    const exported = store.exportCandidate(own.id);
    expect(exported.contacts).toEqual({ recruiters: [], messages: [], statuses: [] });
    expect(exported.careerSections).toMatchObject({ companyWants: [], growthGoals: [], professionPath: [], subscriptionVacancies: [] });
    expect(tables()).toEqual(before);
  });
});
