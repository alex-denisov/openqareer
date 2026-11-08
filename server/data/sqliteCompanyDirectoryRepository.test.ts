import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  SqliteCompanyDirectoryRepository,
  type CompanyDirectoryRecord,
} from './sqliteCompanyDirectoryRepository';
import { COMPANY_DIRECTORY_MIGRATION } from './companyDirectorySchema';

describe('SqliteCompanyDirectoryRepository', () => {
  it('marks ATS boards answering 404 dormant on an already seeded database, once', () => {
    const db = new DatabaseSync(':memory:');
    const repo = new SqliteCompanyDirectoryRepository(db);
    const base = {
      companyName: 'X',
      websiteUrl: null,
      careersUrl: null,
      linkedinUrl: null,
      linkedinOrgId: null,
      sourceType: 'ats_direct',
      status: 'active',
      geo: null,
      industry: null,
      domainGroup: null,
      notes: null,
      createdAt: '2026-11-05T10:00:00Z',
      updatedAt: '2026-11-05T10:00:00Z',
    } as const;
    repo.upsertBatch([
      { ...base, companyKey: 'postman', atsProvider: 'greenhouse', atsSlug: 'postman' },
      { ...base, companyKey: 'postman-moved', atsProvider: 'ashby', atsSlug: 'postman' },
      { ...base, companyKey: 'datagrail', atsProvider: 'greenhouse', atsSlug: 'datagrail' },
    ]);

    const reopened = new SqliteCompanyDirectoryRepository(db);
    const statusOf = (key: string): string | undefined =>
      reopened.listCompanies({}).find((company) => company.companyKey === key)?.status;

    expect(statusOf('postman')).toBe('dormant');
    expect(statusOf('postman-moved')).toBe('active');
    expect(statusOf('datagrail')).toBe('active');
  });

  function makeRepo(): SqliteCompanyDirectoryRepository {
    const db = new DatabaseSync(':memory:');
    return new SqliteCompanyDirectoryRepository(db);
  }

  const sampleUzum: CompanyDirectoryRecord = {
    companyKey: 'uzum',
    companyName: 'Uzum',
    websiteUrl: 'https://uzum.com',
    careersUrl: 'https://people.uzum.com/career/ru/vacancies/3688',
    linkedinUrl: 'https://www.linkedin.com/company/uzum-uz/jobs/',
    linkedinOrgId: null,
    sourceType: 'corporate_portal',
    atsProvider: null,
    atsSlug: null,
    status: 'active',
    geo: 'Uzbekistan; Remote',
    industry: 'E-commerce, Fintech',
    domainGroup: 'Fintech, Payments, Banking, Trading',
    notes: 'Uzum ecosystem in Uzbekistan',
    createdAt: '2026-11-05T10:00:00Z',
    updatedAt: '2026-11-05T10:00:00Z',
  };

  it('сохраняет компанию и читает её по ключу и имени', () => {
    const repo = makeRepo();
    repo.upsertCompany(sampleUzum);

    const byKey = repo.getCompany('uzum');
    expect(byKey).toBeDefined();
    expect(byKey?.companyName).toBe('Uzum');
    expect(byKey?.websiteUrl).toBe('https://uzum.com');
    expect(byKey?.careersUrl).toBe('https://people.uzum.com/career/ru/vacancies/3688');
    expect(byKey?.linkedinUrl).toBe('https://www.linkedin.com/company/uzum-uz/jobs/');
    expect(byKey?.sourceType).toBe('corporate_portal');

    const byName = repo.getCompanyByName('uzum');
    expect(byName?.companyKey).toBe('uzum');
  });

  it('обновляет существующую запись при повторном сохранении', () => {
    const repo = makeRepo();
    repo.upsertCompany(sampleUzum);

    const updated: CompanyDirectoryRecord = {
      ...sampleUzum,
      websiteUrl: 'https://uzum.com/en',
      linkedinOrgId: '8912345',
      updatedAt: '2026-11-05T10:30:00Z',
    };
    repo.upsertCompany(updated);

    const res = repo.getCompany('uzum');
    expect(res?.websiteUrl).toBe('https://uzum.com/en');
    expect(res?.linkedinOrgId).toBe('8912345');
    expect(repo.countCompanies()).toBe(1);
  });

  it('фильтрует по типу источника, статусу и поисковой строке', () => {
    const repo = makeRepo();
    repo.upsertBatch([
      sampleUzum,
      {
        companyKey: 'plata-card',
        companyName: 'Plata Card',
        websiteUrl: 'https://platacard.mx',
        careersUrl: 'https://plata.careers/',
        linkedinUrl: 'https://www.linkedin.com/company/platacardmx/jobs/',
        linkedinOrgId: null,
        sourceType: 'corporate_portal',
        atsProvider: null,
        atsSlug: null,
        status: 'active',
        geo: 'Mexico; Remote',
        industry: 'Fintech',
        domainGroup: 'Fintech',
        notes: null,
        createdAt: '2026-11-05T10:00:00Z',
        updatedAt: '2026-11-05T10:00:00Z',
      },
      {
        companyKey: 'datadome',
        companyName: 'DataDome',
        websiteUrl: 'https://datadome.co',
        careersUrl: 'https://www.linkedin.com/company/datadome/jobs/',
        linkedinUrl: 'https://www.linkedin.com/company/datadome/jobs/',
        linkedinOrgId: '10398947',
        sourceType: 'linkedin_guest',
        atsProvider: null,
        atsSlug: null,
        status: 'active',
        geo: 'USA; France',
        industry: 'Cybersecurity',
        domainGroup: 'Cybersecurity',
        notes: null,
        createdAt: '2026-11-05T10:00:00Z',
        updatedAt: '2026-11-05T10:00:00Z',
      },
      {
        companyKey: 'dormant-co',
        companyName: 'Dormant Co',
        websiteUrl: 'https://dormant.example',
        careersUrl: null,
        linkedinUrl: null,
        linkedinOrgId: null,
        sourceType: 'corporate_portal',
        atsProvider: null,
        atsSlug: null,
        status: 'dormant',
        geo: null,
        industry: null,
        domainGroup: null,
        notes: '0 vacancies',
        createdAt: '2026-11-05T10:00:00Z',
        updatedAt: '2026-11-05T10:00:00Z',
      },
    ]);

    expect(repo.countCompanies()).toBe(4);

    const portals = repo.listCompanies({ sourceType: 'corporate_portal', status: 'active' });
    expect(portals.map((c) => c.companyKey)).toEqual(['plata-card', 'uzum']);

    const liOnly = repo.listCompanies({ sourceType: 'linkedin_guest' });
    expect(liOnly.map((c) => c.companyKey)).toEqual(['datadome']);

    const searchRes = repo.listCompanies({ search: 'Plata' });
    expect(searchRes).toHaveLength(1);
    expect(searchRes[0]?.companyName).toBe('Plata Card');
  });

  it('автоматически заполняет справочник из seed-файла и не содержит keyword-поиска', () => {
    const repo = new SqliteCompanyDirectoryRepository({
      databasePath: ':memory:',
      autoSeed: true,
    });

    const count = repo.countCompanies();
    expect(count).toBeGreaterThan(1000);

    const sample = repo.getCompany('uzum');
    expect(sample?.companyName).toBe('uzum');
    expect(sample?.careersUrl).toBe('https://people.uzum.com/career/ru/vacancies/3688');
    expect(sample?.websiteUrl).toBe('https://uzum.com/');
    expect(sample?.linkedinUrl).toBe('https://www.linkedin.com/company/uzum-uz/jobs/');

    // Проверяем, что ни у одной компании нет search/?keywords=
    const all = repo.listCompanies();
    const withKeywords = all.filter(
      (c) =>
        (c.careersUrl && c.careersUrl.includes('search/?keywords=')) ||
        (c.linkedinUrl && c.linkedinUrl.includes('search/?keywords=')),
    );
    expect(withKeywords).toHaveLength(0);

    repo.close();
  });

  it('у каждого пустого обязательного поля есть причина в evidence (B619)', () => {
    const repo = new SqliteCompanyDirectoryRepository({
      databasePath: ':memory:',
      autoSeed: true,
    });

    const all = repo.listCompanies();
    expect(all.length).toBeGreaterThan(1000);
    const required = ['websiteUrl', 'careersUrl', 'linkedinUrl', 'geo', 'industry', 'domainGroup', 'linkedinOrgId'] as const;
    const unexplained = all.flatMap((c) =>
      required
        .filter((field) => !c[field])
        .filter((field) => {
          const entry = c.evidence?.[field] as { how?: string } | undefined;
          return !entry?.how;
        })
        .map((field) => `${c.companyKey}.${field}`),
    );

    expect(unexplained).toEqual([]);
    repo.close();
  });

  it('добавляет колонку evidence в уже существующую таблицу и читает её как объект', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(COMPANY_DIRECTORY_MIGRATION);
    const repo = new SqliteCompanyDirectoryRepository(db);
    repo.upsertCompany({
      companyKey: 'acme', companyName: 'Acme', websiteUrl: 'https://acme.com/', careersUrl: null,
      linkedinUrl: null, linkedinOrgId: null, sourceType: 'corporate_portal', atsProvider: null,
      atsSlug: null, status: 'active', geo: null, industry: null, domainGroup: null, notes: null,
      createdAt: '2026-11-09T00:00:00Z', updatedAt: '2026-11-09T00:00:00Z',
      evidence: { careersUrl: { value: null, how: 'not found' } },
    });
    expect(repo.getCompany('acme')?.evidence).toEqual({ careersUrl: { value: null, how: 'not found' } });
    db.close();
  });
});
