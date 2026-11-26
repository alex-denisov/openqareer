import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { PLACEMENT_TABLES } from './placementSchema';
import { resolveCompanyFromAggregator, updateCompanySiteFromAggregator } from './aggregatorCompanyResolve';
import { AggregatorCompanyBackfill } from './aggregatorBackfill';
import { VACANCY_CLUSTER_INPUT_TABLE, VACANCY_POOL_INDEX_TABLE } from '../../data/sqliteSchema';

function setupDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE company_directory (
    company_key TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    website_url TEXT,
    careers_url TEXT,
    linkedin_url TEXT,
    linkedin_org_id TEXT,
    source_type TEXT NOT NULL,
    ats_provider TEXT,
    ats_slug TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    geo TEXT,
    industry TEXT,
    domain_group TEXT,
    notes TEXT,
    evidence TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );`);
  db.exec(PLACEMENT_TABLES);
  db.exec(VACANCY_POOL_INDEX_TABLE + VACANCY_CLUSTER_INPUT_TABLE);
  return db;
}

describe('resolveCompanyFromAggregator', () => {
  it('auto-resolves an unlinked company when employerSite is present', () => {
    const db = setupDb();
    const nowMs = 1731750000000;
    const resolved = resolveCompanyFromAggregator(
      db,
      {
        company: 'ООО Россети Урал',
        site: 'https://rosseti-ural.ru/career/',
        sourceId: 'src-trudvsem',
        sampleVacancyId: 'tv-1',
      },
      nowMs,
    );

    expect(resolved).toEqual({ companyKey: 'rosseti-ural', how: 'exact_name' });

    const dirRow = db.prepare('SELECT company_key, company_name, website_url, source_type, status FROM company_directory WHERE company_key = ?')
      .get('rosseti-ural') as Record<string, string>;
    expect(dirRow).toEqual({
      company_key: 'rosseti-ural',
      company_name: 'ООО Россети Урал',
      website_url: 'https://rosseti-ural.ru/',
      source_type: 'corporate_portal',
      status: 'active',
    });

    const placements = db.prepare('SELECT placement_id, company_key, type, priority, discovered_by FROM company_placement WHERE company_key = ?')
      .all('rosseti-ural');
    expect(placements).toEqual([
      { placement_id: 'site:rosseti-ural.ru', company_key: 'rosseti-ural', type: 'employer_site', priority: 1, discovered_by: 'aggregator_site' },
    ]);

    const queueRow = db.prepare('SELECT name_key, company_name, status, sample_vacancy_id FROM company_discovery_queue WHERE name_key = ?')
      .get('rosseti-ural') as Record<string, string>;
    expect(queueRow).toEqual({
      name_key: 'rosseti-ural',
      company_name: 'ООО Россети Урал',
      status: 'resolved',
      sample_vacancy_id: 'tv-1',
    });
  });

  it('records hh employer placement when employerId is present', () => {
    const db = setupDb();
    const nowMs = 1731750000000;
    const resolved = resolveCompanyFromAggregator(
      db,
      {
        company: 'Яндекс Крауд',
        site: 'https://crowd.yandex.ru/',
        employerId: '9498112',
        sourceId: 'src-hh-search',
        sampleVacancyId: 'hh-1',
      },
      nowMs,
    );

    expect(resolved).toEqual({ companyKey: 'yandeks-kraud', how: 'exact_name' });

    const placements = db.prepare('SELECT placement_id, company_key, type, priority FROM company_placement WHERE company_key = ? ORDER BY priority')
      .all('yandeks-kraud');
    expect(placements).toEqual([
      { placement_id: 'site:crowd.yandex.ru', company_key: 'yandeks-kraud', type: 'employer_site', priority: 1 },
      { placement_id: 'hh:9498112', company_key: 'yandeks-kraud', type: 'aggregator', priority: 4 },
    ]);
  });

  it('resolves site from freehire_company_source_candidates when vacancy site is missing', () => {
    const db = setupDb();
    db.exec(`CREATE TABLE freehire_company_source_candidates (slug TEXT PRIMARY KEY, evidence TEXT NOT NULL, fetched_at TEXT NOT NULL)`);
    db.prepare(`INSERT INTO freehire_company_source_candidates VALUES (?, ?, ?)`).run(
      'uzum',
      JSON.stringify({
        slug: 'uzum',
        name: 'Uzum',
        website: 'https://uzum.com',
        boards: [{ provider: 'greenhouse', slug: 'uzum' }],
      }),
      '2026-11-16T10:00:00Z',
    );

    const nowMs = 1731750000000;
    const resolved = resolveCompanyFromAggregator(
      db,
      {
        company: 'Uzum Technologies',
        sourceId: 'src-hh-search',
        sampleVacancyId: 'hh-uzum',
      },
      nowMs,
    );

    expect(resolved).toEqual({ companyKey: 'uzum-technologies', how: 'exact_name' });

    const dirRow = db.prepare('SELECT website_url FROM company_directory WHERE company_key = ?').get('uzum-technologies') as { website_url: string };
    expect(dirRow.website_url).toBe('https://uzum.com/');

    const placements = db.prepare('SELECT placement_id, type FROM company_placement WHERE company_key = ? ORDER BY placement_id').all('uzum-technologies');
    expect(placements).toEqual([
      { placement_id: 'ats:greenhouse:uzum', type: 'ats' },
      { placement_id: 'site:uzum.com', type: 'employer_site' },
    ]);
  });

  it('enqueues unlinked company without site into company_discovery_queue as pending', () => {
    const db = setupDb();
    const nowMs = 1731750000000;
    const resolved = resolveCompanyFromAggregator(
      db,
      {
        company: 'Неизвестная Компания Продакшн',
        sourceId: 'src-trudvsem',
        sampleVacancyId: 'tv-unknown',
      },
      nowMs,
    );

    expect(resolved).toBeNull();

    const queueRow = db.prepare('SELECT name_key, vacancies_count, status FROM company_discovery_queue WHERE name_key = ?')
      .get('neizvestnaya-kompaniya-prodakshn') as Record<string, unknown>;
    expect(queueRow).toEqual({
      name_key: 'neizvestnaya-kompaniya-prodakshn',
      vacancies_count: 1,
      status: 'pending',
    });

    // Calling again increments vacancies_count
    resolveCompanyFromAggregator(
      db,
      {
        company: 'Неизвестная Компания Продакшн',
        sourceId: 'src-trudvsem',
        sampleVacancyId: 'tv-unknown-2',
      },
      nowMs + 1000,
    );
    const updated = db.prepare('SELECT vacancies_count, sample_vacancy_id FROM company_discovery_queue WHERE name_key = ?')
      .get('neizvestnaya-kompaniya-prodakshn') as Record<string, unknown>;
    expect(updated).toEqual({
      vacancies_count: 2,
      sample_vacancy_id: 'tv-unknown-2',
    });
  });

  it('skips individuals and generic names', () => {
    const db = setupDb();
    const nowMs = 1731750000000;
    expect(resolveCompanyFromAggregator(db, { company: 'Иванов Иван', employerIsPerson: true, sourceId: 'src-hh-search' }, nowMs)).toBeNull();
    expect(resolveCompanyFromAggregator(db, { company: 'Конфиденциально', sourceId: 'src-hh-search' }, nowMs)).toBeNull();
    expect(resolveCompanyFromAggregator(db, { company: 'Частный работодатель', sourceId: 'src-hh-search' }, nowMs)).toBeNull();
    expect(db.prepare('SELECT count(*) as count FROM company_discovery_queue').get()).toEqual({ count: 0 });
  });

  it('updates company_directory website_url for already linked companies when NULL', () => {
    const db = setupDb();
    db.prepare(`INSERT INTO company_directory (company_key, company_name, source_type, created_at, updated_at) VALUES ('alfa', 'Альфа', 'aggregator', '2026-11-01', '2026-11-01')`).run();

    const nowMs = 1731750000000;
    updateCompanySiteFromAggregator(db, 'alfa', 'https://alfabank.ru/careers/', nowMs);

    const dirRow = db.prepare('SELECT website_url FROM company_directory WHERE company_key = ?').get('alfa') as { website_url: string };
    expect(dirRow.website_url).toBe('https://alfabank.ru/');

    const placement = db.prepare('SELECT placement_id, type FROM company_placement WHERE company_key = ?').get('alfa');
    expect(placement).toEqual({ placement_id: 'site:alfabank.ru', type: 'employer_site' });
  });

  it('integration: AggregatorCompanyBackfill with autoResolve links unlinked vacancy with site and creates company', () => {
    const db = setupDb();
    const add = (id: string, source: string, json: object) => {
      db.prepare(`INSERT INTO vacancy_pool_index (id, source_id, is_active, url, search_text, expired) VALUES (?, ?, 1, 'u', '', 0)`).run(id, source);
      db.prepare('INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)').run(id, JSON.stringify(json));
    };
    add('tv-1', 'src-trudvsem', { company: 'ООО Россети Урал', employerSite: 'https://rosseti-ural.ru/career/' });
    add('tv-2', 'src-trudvsem', { company: 'ООО Россети Урал', employerSite: 'https://rosseti-ural.ru/career/' });

    const backfill = new AggregatorCompanyBackfill(db, { chunk: 10, autoResolve: true });
    for (let i = 0; i < 10; i++) {
      if (backfill.step().done) break;
    }

    const links = db.prepare('SELECT vacancy_id, company_key, match_how FROM vacancy_company ORDER BY vacancy_id').all();
    expect(links).toEqual([
      { vacancy_id: 'tv-1', company_key: 'rosseti-ural', match_how: 'exact_name' },
      { vacancy_id: 'tv-2', company_key: 'rosseti-ural', match_how: 'exact_name' },
    ]);

    const company = db.prepare('SELECT company_key, company_name, website_url FROM company_directory WHERE company_key = ?').get('rosseti-ural') as Record<string, string>;
    expect(company).toMatchObject({
      company_key: 'rosseti-ural',
      company_name: 'ООО Россети Урал',
      website_url: 'https://rosseti-ural.ru/',
    });
  });
});
