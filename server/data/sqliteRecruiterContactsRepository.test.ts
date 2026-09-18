import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { RecruiterContact } from '../../shared/recruiterContact';
import { SqliteRecruiterContactsRepository } from './sqliteRecruiterContactsRepository';

describe('SqliteRecruiterContactsRepository', () => {
  function createRepo(): {
    repo: SqliteRecruiterContactsRepository;
    db: DatabaseSync;
  } {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteRecruiterContactsRepository(db);
    return { repo, db };
  }

  const sampleContact1: RecruiterContact = {
    id: 'rc-1',
    vacancyId: 'vac-101',
    companyName: 'Acme Corp',
    fullName: 'Елена Смирнова',
    roleTitle: 'Technical Recruiter',
    email: 'elena.smirnova@acmecorp.com',
    emailStatus: 'verified',
    phone: '+7 999 123-45-67',
    telegram: '@elena_recruiter',
    whatsapp: 'https://wa.me/79991234567',
    linkedinUrl: 'https://www.linkedin.com/in/elena-smirnova',
    githubUrl: null,
    twitterUrl: null,
    sourceType: 'osint_discovery',
    confidence: 0.95,
    createdAt: '2026-09-17T10:00:00.000Z',
    updatedAt: '2026-09-17T10:00:00.000Z',
  };

  const sampleContact2: RecruiterContact = {
    id: 'rc-2',
    vacancyId: 'vac-101',
    companyName: 'Acme Corp',
    fullName: 'Алексей Иванов',
    roleTitle: 'Engineering Manager',
    email: 'alexey.ivanov@acmecorp.com',
    emailStatus: 'hypothesis',
    phone: null,
    telegram: null,
    whatsapp: null,
    linkedinUrl: 'https://www.linkedin.com/in/alexey-ivanov',
    githubUrl: 'https://github.com/alexey-ivanov',
    twitterUrl: 'https://x.com/alexey_tech',
    sourceType: 'domain_pattern',
    confidence: 0.7,
    createdAt: '2026-09-17T10:00:00.000Z',
    updatedAt: '2026-09-17T10:00:00.000Z',
  };

  it('сохраняет и извлекает контакты по vacancy_id', () => {
    const { repo } = createRepo();
    repo.saveContacts('vac-101', [sampleContact1, sampleContact2]);

    const retrieved = repo.getContactsByVacancyId('vac-101');
    expect(retrieved).toHaveLength(2);
    expect(retrieved[0]).toEqual(sampleContact1);
    expect(retrieved[1]).toEqual(sampleContact2);
  });

  it('возвращает пустой массив для вакансии без контактов', () => {
    const { repo } = createRepo();
    const retrieved = repo.getContactsByVacancyId('non-existent');
    expect(retrieved).toEqual([]);
  });

  it('замещает контакты при повторном вызове saveContacts для одной вакансии', () => {
    const { repo } = createRepo();
    repo.saveContacts('vac-101', [sampleContact1]);

    const updatedContact: RecruiterContact = {
      ...sampleContact1,
      roleTitle: 'Lead Talent Partner',
      emailStatus: 'verified',
    };
    repo.saveContacts('vac-101', [updatedContact]);

    const retrieved = repo.getContactsByVacancyId('vac-101');
    expect(retrieved).toHaveLength(1);
    expect(retrieved[0].roleTitle).toBe('Lead Talent Partner');
  });

  it('удаляет контакты по vacancy_id без влияния на другие вакансии', () => {
    const { repo } = createRepo();
    repo.saveContacts('vac-101', [sampleContact1]);
    const otherContact: RecruiterContact = {
      ...sampleContact2,
      id: 'rc-other',
      vacancyId: 'vac-202',
    };
    repo.saveContacts('vac-202', [otherContact]);

    repo.deleteContactsByVacancyId('vac-101');

    expect(repo.getContactsByVacancyId('vac-101')).toEqual([]);
    expect(repo.getContactsByVacancyId('vac-202')).toHaveLength(1);
  });

  it('корректно работает при передаче пути к файлу базы данных', () => {
    const repo = new SqliteRecruiterContactsRepository({ databasePath: ':memory:' });
    repo.saveContacts('vac-1', [sampleContact1]);
    expect(repo.getContactsByVacancyId('vac-1')).toHaveLength(1);
  });

  it('изолирует записи одинаковой вакансии между кандидатами', () => {
    const { repo } = createRepo();
    repo.saveContacts('candidate-a', 'vac-101', [sampleContact1]);
    repo.saveContacts('candidate-b', 'vac-101', [{ ...sampleContact1, id: 'rc-b', telegram: '@other' }]);

    expect(repo.getContactsByVacancyId('candidate-a', 'vac-101')[0]?.telegram).toBe('@elena_recruiter');
    expect(repo.getContactsByVacancyId('candidate-b', 'vac-101')[0]?.telegram).toBe('@other');
    expect(repo.deleteContactsByCandidateId('candidate-a')).toBe(1);
    expect(repo.getContactsByVacancyId('candidate-b', 'vac-101')).toHaveLength(1);
  });
});
