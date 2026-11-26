import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { COMPANY_DIRECTORY_MIGRATION } from '../server/data/companyDirectorySchema.js';
import { PLACEMENT_TABLES } from '../server/companyDirectory/placement/placementSchema.js';
import { importVerifiedCompanySources } from './import-verified-company-sources.js';

const NOW = '2026-11-16T12:00:00.000Z';
const databases: DatabaseSync[] = [];

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec(COMPANY_DIRECTORY_MIGRATION);
  db.exec('ALTER TABLE company_directory ADD COLUMN evidence TEXT');
  db.exec(PLACEMENT_TABLES);
  db.exec(`CREATE TABLE vacancy_source_state (
    source_id TEXT PRIMARY KEY,
    items_found_total INTEGER NOT NULL DEFAULT 0,
    items_active_total INTEGER NOT NULL DEFAULT 0,
    sync_requested_at TEXT
  ) STRICT`);
  return db;
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function seedCompany(db: DatabaseSync, key = 'acme', name = 'Acme'): void {
  db.prepare(
    `
    INSERT INTO company_directory
      (company_key, company_name, source_type, status, created_at, updated_at, evidence)
    VALUES (?, ?, 'corporate_portal', 'active', ?, ?, ?)
  `,
  ).run(key, name, NOW, NOW, JSON.stringify({ retained: 'directory evidence' }));
}

type Snapshot = {
  companyName: string;
  websiteUrl: string | null;
  careersUrl: string | null;
  linkedinUrl: string | null;
  linkedinOrgId: string | null;
  atsProvider: string | null;
  atsSlug: string | null;
  geo: string | null;
  industry: string | null;
  domainGroup: string | null;
};

function currentCompany(db: DatabaseSync, key = 'acme'): Snapshot {
  return db
    .prepare(
      `
    SELECT company_name AS companyName, website_url AS websiteUrl, careers_url AS careersUrl,
           linkedin_url AS linkedinUrl, linkedin_org_id AS linkedinOrgId, ats_provider AS atsProvider,
           ats_slug AS atsSlug, geo, industry, domain_group AS domainGroup
      FROM company_directory WHERE company_key = ?
  `,
    )
    .get(key) as Snapshot;
}

function record(db: DatabaseSync, key = 'acme', slug = 'Acme', provider = 'lever') {
  const careersUrl =
    provider === 'ashby' ? 'https://jobs.ashbyhq.com/flipper' : 'https://jobs.lever.co/acme';
  const linkedinUrl =
    provider === 'ashby'
      ? 'https://www.linkedin.com/jobs/search/?f_C=123&location=Remote'
      : 'https://www.linkedin.com/company/acme/jobs/';
  const profile = {
    websiteUrl: 'https://acme.example/',
    careersUrl,
    linkedinUrl,
    linkedinOrgId: '123',
    geo: 'United States',
    industry: 'Software',
    domainGroup: 'Enterprise software',
  };
  return {
    companyKey: key,
    companyName: currentCompany(db, key).companyName,
    expectedCompany: currentCompany(db, key),
    profile,
    ats: { provider, slug, sourceId: `ats-${provider}-${slug}` },
    allowEmptyTechnicalAliasAdoption: undefined as boolean | undefined,
    expectedPlacement: undefined as
      | {
          placementId: string;
          companyKey: string | null;
          type: string;
          provider: string | null;
          slug: string | null;
          url: string | null;
          priority: number;
          sourceId: string | null;
          discoveredBy: string;
          updatedAt: number;
        }
      | undefined,
    evidence: {
      verifiedAt: NOW,
      sourceUrls: {
        websiteUrl: profile.websiteUrl,
        careersUrl,
        linkedinUrl,
        linkedinOrgId: linkedinUrl,
        geo: 'https://acme.example/about',
        industry: 'https://acme.example/about',
        domainGroup: 'https://acme.example/about',
        atsBoardUrl: careersUrl,
      },
    },
  };
}

function count(db: DatabaseSync, table: string): number {
  return Number(db.prepare(`SELECT count(*) AS count FROM ${table}`).get()?.count);
}

describe('verified company source batch importer', () => {
  it('previews before and after values in dry-run without writing', () => {
    const db = database();
    seedCompany(db);
    const input = { version: 1, records: [record(db)] };

    const result = importVerifiedCompanySources(db, input, false, NOW);

    expect(result[0]).toMatchObject({
      companyKey: 'acme',
      sourceId: 'ats-lever-Acme',
      status: 'would-apply',
      before: { placement: null, syncRequestedAt: null },
      after: {
        company: { websiteUrl: 'https://acme.example/' },
        placement: {
          placementId: 'ats:lever:acme',
          sourceId: 'ats-lever-Acme',
          url: 'https://jobs.lever.co/acme',
        },
        syncRequestedAt: NOW,
      },
    });
    expect(currentCompany(db)).toMatchObject({ websiteUrl: null, atsProvider: null });
    expect(count(db, 'company_placement')).toBe(0);
    expect(count(db, 'vacancy_source_state')).toBe(0);
  });

  it('applies the seven fields, exact source ID, evidence markers, and sync request', () => {
    const db = database();
    seedCompany(db);
    const input = { version: 1, records: [record(db)] };

    const result = importVerifiedCompanySources(db, input, true, NOW);

    expect(result[0]).toMatchObject({
      status: 'applied',
      after: { syncRequestedAt: NOW },
    });
    expect(currentCompany(db)).toMatchObject({
      websiteUrl: 'https://acme.example/',
      careersUrl: 'https://jobs.lever.co/acme',
      linkedinUrl: 'https://www.linkedin.com/company/acme/jobs/',
      linkedinOrgId: '123',
      atsProvider: 'lever',
      atsSlug: 'Acme',
      geo: 'United States',
      industry: 'Software',
      domainGroup: 'Enterprise software',
    });
    expect(
      db.prepare('SELECT source_id AS sourceId, url, evidence FROM company_placement').get(),
    ).toMatchObject({
      sourceId: 'ats-lever-Acme',
      url: 'https://jobs.lever.co/acme',
    });
    const placementEvidence = JSON.parse(
      (db.prepare('SELECT evidence FROM company_placement').get() as { evidence: string }).evidence,
    );
    const directoryEvidence = JSON.parse(
      (db.prepare('SELECT evidence FROM company_directory').get() as { evidence: string }).evidence,
    );
    expect(placementEvidence.verifiedImport).toMatchObject({
      sourceId: 'ats-lever-Acme',
      provider: 'lever',
    });
    expect(directoryEvidence).toMatchObject({
      retained: 'directory evidence',
      verifiedImport: { sourceId: 'ats-lever-Acme' },
    });
    expect(
      db.prepare('SELECT sync_requested_at AS requestedAt FROM vacancy_source_state').get(),
    ).toEqual({ requestedAt: NOW });
    expect(
      db.prepare('SELECT source_type AS sourceType, status FROM company_directory').get(),
    ).toEqual({ sourceType: 'corporate_portal', status: 'active' });
  });

  it('keeps a whole batch unchanged when a later existing-row CAS is stale', () => {
    const db = database();
    seedCompany(db, 'acme', 'Acme');
    seedCompany(db, 'beta', 'Beta');
    const first = record(db, 'acme');
    const stale = record(db, 'beta', 'Beta');
    stale.expectedCompany.websiteUrl = 'https://stale.example/';
    const input = { version: 1, records: [first, stale] };

    expect(() => importVerifiedCompanySources(db, input, true, NOW)).toThrow(
      /company websiteUrl compare-and-set failed/,
    );
    expect(currentCompany(db, 'acme')).toMatchObject({ websiteUrl: null, atsProvider: null });
    expect(count(db, 'company_placement')).toBe(0);
    expect(count(db, 'vacancy_source_state')).toBe(0);
  });

  it('adopts only an explicitly snapshotted empty technical alias', () => {
    const db = database();
    seedCompany(db);
    db.prepare(`UPDATE company_directory SET ats_provider = 'lever', ats_slug = 'Acme'`).run();
    const inputRecord = record(db);
    inputRecord.expectedCompany = currentCompany(db);
    db.prepare(
      `
      INSERT INTO company_placement
        (placement_id, company_key, type, provider, slug, url, priority, source_id,
         discovered_by, evidence, updated_at)
      VALUES ('ats:lever:acme', 'acme', 'ats', 'lever', 'acme', NULL, 2, NULL,
              'directory', '{"alias":"keep"}', 100)
    `,
    ).run();
    inputRecord.expectedPlacement = {
      placementId: 'ats:lever:acme',
      companyKey: 'acme',
      type: 'ats',
      provider: 'lever',
      slug: 'acme',
      url: null,
      priority: 2,
      sourceId: null,
      discoveredBy: 'directory',
      updatedAt: 100,
    };
    const denied = { ...inputRecord, allowEmptyTechnicalAliasAdoption: false };
    expect(() =>
      importVerifiedCompanySources(db, { version: 1, records: [denied] }, true, NOW),
    ).toThrow(/placement reassignment requires explicit empty-alias CAS/);
    expect(db.prepare('SELECT source_id AS sourceId FROM company_placement').get()).toEqual({
      sourceId: null,
    });

    inputRecord.allowEmptyTechnicalAliasAdoption = true;
    importVerifiedCompanySources(db, { version: 1, records: [inputRecord] }, true, NOW);

    const placement = db
      .prepare('SELECT source_id AS sourceId, url, evidence FROM company_placement')
      .get() as { sourceId: string; url: string; evidence: string };
    expect(placement).toMatchObject({
      sourceId: 'ats-lever-Acme',
      url: 'https://jobs.lever.co/acme',
    });
    expect(JSON.parse(placement.evidence)).toMatchObject({
      alias: 'keep',
      verifiedImport: { sourceId: 'ats-lever-Acme' },
    });
  });

  it('rolls directory and placement writes back if source sync enqueue fails', () => {
    const db = database();
    seedCompany(db);
    db.exec(`
      CREATE TRIGGER reject_sync BEFORE INSERT ON vacancy_source_state
      BEGIN SELECT RAISE(ABORT, 'sync unavailable'); END
    `);

    expect(() =>
      importVerifiedCompanySources(db, { version: 1, records: [record(db)] }, true, NOW),
    ).toThrow(/sync unavailable/);
    expect(currentCompany(db)).toMatchObject({ websiteUrl: null, atsProvider: null });
    expect(count(db, 'company_placement')).toBe(0);
    expect(count(db, 'vacancy_source_state')).toBe(0);
  });

  it('preserves encoded ATS slugs and validates org-filtered LinkedIn URLs', () => {
    const db = database();
    seedCompany(db, 'flipper', 'Flipper Devices');
    const inputRecord = record(db, 'flipper', 'Flipper%20Jobs', 'ashby');
    inputRecord.profile.careersUrl = 'https://jobs.ashbyhq.com/flipper%20jobs';
    inputRecord.evidence.sourceUrls.careersUrl = inputRecord.profile.careersUrl;
    inputRecord.evidence.sourceUrls.atsBoardUrl = inputRecord.profile.careersUrl;

    const preview = importVerifiedCompanySources(
      db,
      { version: 1, records: [inputRecord] },
      false,
      NOW,
    );

    expect(preview[0].sourceId).toBe('ats-ashby-Flipper%20Jobs');
    expect(preview[0].after.placement.placementId).toBe('ats:ashby:flipper%20jobs');
    inputRecord.profile.linkedinUrl =
      'https://www.linkedin.com/jobs/search/?f_C=123&keywords=engineer';
    inputRecord.evidence.sourceUrls.linkedinUrl = inputRecord.profile.linkedinUrl;
    expect(() =>
      importVerifiedCompanySources(db, { version: 1, records: [inputRecord] }, false, NOW),
    ).toThrow(/keywords=/);
  });
});
