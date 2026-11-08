import { describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import {
  CORPORATE_JSON_ENDPOINTS,
  fetchCorporateJsonApiVacancies,
} from './corporateJsonApiAdapter';
import {
  NEXT_DATA_CAREER_ENDPOINTS,
  fetchNextDataVacancies,
} from './nextDataCareerAdapter';
import {
  CORPORATE_HTML_ENDPOINTS,
  fetchCorporateHtmlVacancies,
} from './corporateHtmlAdapter';
import {
  LINKEDIN_GROUP_B_TARGETS,
  fetchLinkedinCompanyVacancies,
} from './linkedinCompanyGuestAdapter';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { useRecordedFetch } from './__fixtures__/recordedFetch';

describe('Corporate & Group B Production Ingestion Gate', () => {
  useRecordedFetch('corporateProductionIngestion');
  it('persists EPAM (Corporate JSON API) into SQLite pool with active status and full schema', async () => {
    const epamEndpoint = CORPORATE_JSON_ENDPOINTS.find((e) => e.id === 'epam')!;
    const vacancies = await fetchCorporateJsonApiVacancies(epamEndpoint, { maxPages: 1 });
    expect(vacancies.length).toBeGreaterThan(0);

    const tempDir = mkdtempSync(join(tmpdir(), 'epam-ingest-'));
    const dbPath = join(tempDir, 'pool.db');

    try {
      const poolStore = new SqliteVacancyPoolStore({ databasePath: dbPath });
      poolStore.mergeSourceSlice('src-epam', vacancies);

      const db = new DatabaseSync(dbPath);
      const rows = db
        .prepare('SELECT id, source_id, payload FROM vacancy_pool WHERE source_id = ?')
        .all('src-epam') as Array<{ id: string; source_id: string; payload: string }>;
      expect(rows.length).toBe(vacancies.length);

      const firstPayload = JSON.parse(rows[0]!.payload);
      expect(firstPayload.company).toBe('EPAM');
      expect(firstPayload.status).toBe('active');
      expect(firstPayload.description.length).toBeGreaterThan(0);

      const indexRows = db
        .prepare('SELECT id, is_active FROM vacancy_pool_index WHERE source_id = ?')
        .all('src-epam') as Array<{ id: string; is_active: number }>;
      expect(indexRows.length).toBe(vacancies.length);
      expect(indexRows[0]!.is_active).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists Playrix (Corporate JSON API) into SQLite pool according to production rules', async () => {
    const playrixEndpoint = CORPORATE_JSON_ENDPOINTS.find((e) => e.id === 'playrix')!;
    const vacancies = await fetchCorporateJsonApiVacancies(playrixEndpoint, { maxPages: 1 });
    expect(vacancies.length).toBeGreaterThan(0);

    const tempDir = mkdtempSync(join(tmpdir(), 'playrix-ingest-'));
    const dbPath = join(tempDir, 'pool.db');

    try {
      const poolStore = new SqliteVacancyPoolStore({ databasePath: dbPath });
      poolStore.mergeSourceSlice('src-playrix', vacancies);

      const db = new DatabaseSync(dbPath);
      const rows = db
        .prepare('SELECT id, source_id, payload FROM vacancy_pool WHERE source_id = ?')
        .all('src-playrix') as Array<{ id: string; source_id: string; payload: string }>;
      expect(rows.length).toBe(vacancies.length);

      const firstPayload = JSON.parse(rows[0]!.payload);
      expect(firstPayload.company).toBe('Playrix');
      expect(firstPayload.status).toBe('active');
      expect(firstPayload.url).toMatch(/^https:\/\/playrix\.com\/job\//);

      const indexRows = db
        .prepare('SELECT id, is_active FROM vacancy_pool_index WHERE source_id = ?')
        .all('src-playrix') as Array<{ id: string; is_active: number }>;
      expect(indexRows.length).toBe(vacancies.length);
      expect(indexRows[0]!.is_active).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists Preply (Next.js SSR Data) into SQLite pool according to production rules', async () => {
    const preplyEndpoint = NEXT_DATA_CAREER_ENDPOINTS.find((e) => e.id === 'preply')!;
    const vacancies = await fetchNextDataVacancies(preplyEndpoint);
    expect(vacancies.length).toBeGreaterThan(0);

    const tempDir = mkdtempSync(join(tmpdir(), 'preply-ingest-'));
    const dbPath = join(tempDir, 'pool.db');

    try {
      const poolStore = new SqliteVacancyPoolStore({ databasePath: dbPath });
      poolStore.mergeSourceSlice('src-preply', vacancies);

      const db = new DatabaseSync(dbPath);
      const rows = db
        .prepare('SELECT id, source_id, payload FROM vacancy_pool WHERE source_id = ?')
        .all('src-preply') as Array<{ id: string; source_id: string; payload: string }>;
      expect(rows.length).toBe(vacancies.length);

      const firstPayload = JSON.parse(rows[0]!.payload);
      expect(firstPayload.company).toBe('Preply');
      expect(firstPayload.status).toBe('active');
      expect(firstPayload.url).toMatch(/^https:\/\/preply\.com\/en\/careers\/apply\?ashby_jid=/);

      const indexRows = db
        .prepare('SELECT id, is_active FROM vacancy_pool_index WHERE source_id = ?')
        .all('src-preply') as Array<{ id: string; is_active: number }>;
      expect(indexRows.length).toBe(vacancies.length);
      expect(indexRows[0]!.is_active).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists Kaspersky (Corporate HTML) into SQLite pool according to production rules', async () => {
    const endpoint = CORPORATE_HTML_ENDPOINTS.find((e) => e.id === 'kaspersky')!;
    const vacancies = await fetchCorporateHtmlVacancies(endpoint);
    expect(vacancies.length).toBeGreaterThan(0);

    const tempDir = mkdtempSync(join(tmpdir(), 'kaspersky-ingest-'));
    const dbPath = join(tempDir, 'pool.db');

    try {
      const poolStore = new SqliteVacancyPoolStore({ databasePath: dbPath });
      poolStore.mergeSourceSlice('src-kaspersky', vacancies);

      const db = new DatabaseSync(dbPath);
      const rows = db
        .prepare('SELECT id, source_id, payload FROM vacancy_pool WHERE source_id = ?')
        .all('src-kaspersky') as Array<{ id: string; source_id: string; payload: string }>;
      expect(rows.length).toBe(vacancies.length);

      const firstPayload = JSON.parse(rows[0]!.payload);
      expect(firstPayload.company).toBe('Kaspersky');
      expect(firstPayload.status).toBe('active');
      expect(firstPayload.url).toMatch(/^https:\/\/careers\.kaspersky\.com\/vacancy\//);

      const indexRows = db
        .prepare('SELECT id, is_active FROM vacancy_pool_index WHERE source_id = ?')
        .all('src-kaspersky') as Array<{ id: string; is_active: number }>;
      expect(indexRows.length).toBe(vacancies.length);
      expect(indexRows[0]!.is_active).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists Veeam (Corporate HTML) into SQLite pool according to production rules', async () => {
    const endpoint = CORPORATE_HTML_ENDPOINTS.find((e) => e.id === 'veeam')!;
    const vacancies = await fetchCorporateHtmlVacancies(endpoint);
    expect(vacancies.length).toBeGreaterThan(0);

    const tempDir = mkdtempSync(join(tmpdir(), 'veeam-ingest-'));
    const dbPath = join(tempDir, 'pool.db');

    try {
      const poolStore = new SqliteVacancyPoolStore({ databasePath: dbPath });
      poolStore.mergeSourceSlice('src-veeam', vacancies);

      const db = new DatabaseSync(dbPath);
      const rows = db
        .prepare('SELECT id, source_id, payload FROM vacancy_pool WHERE source_id = ?')
        .all('src-veeam') as Array<{ id: string; source_id: string; payload: string }>;
      expect(rows.length).toBe(vacancies.length);

      const firstPayload = JSON.parse(rows[0]!.payload);
      expect(firstPayload.company).toBe('Veeam');
      expect(firstPayload.status).toBe('active');
      expect(firstPayload.url).toMatch(/^https:\/\/careers\.veeam\.com\/job\//);

      const indexRows = db
        .prepare('SELECT id, is_active FROM vacancy_pool_index WHERE source_id = ?')
        .all('src-veeam') as Array<{ id: string; is_active: number }>;
      expect(indexRows.length).toBe(vacancies.length);
      expect(indexRows[0]!.is_active).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists RingCentral (Group B LinkedIn Guest) into SQLite pool without login credentials', async () => {
    const target = LINKEDIN_GROUP_B_TARGETS.find((t) => t.slug === 'ringcentral')!;
    const vacancies = await fetchLinkedinCompanyVacancies(target, { maxPages: 1 });
    expect(vacancies.length).toBeGreaterThan(0);

    const tempDir = mkdtempSync(join(tmpdir(), 'ringcentral-ingest-'));
    const dbPath = join(tempDir, 'pool.db');

    try {
      const poolStore = new SqliteVacancyPoolStore({ databasePath: dbPath });
      poolStore.mergeSourceSlice('src-linkedin-ringcentral', vacancies);

      const db = new DatabaseSync(dbPath);
      const rows = db
        .prepare('SELECT id, source_id, payload FROM vacancy_pool WHERE source_id = ?')
        .all('src-linkedin-ringcentral') as Array<{ id: string; source_id: string; payload: string }>;
      expect(rows.length).toBe(vacancies.length);

      const firstPayload = JSON.parse(rows[0]!.payload);
      expect(firstPayload.company).toBe('RingCentral');
      expect(firstPayload.status).toBe('active');
      expect(firstPayload.url).toMatch(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+/);

      const indexRows = db
        .prepare('SELECT id, is_active FROM vacancy_pool_index WHERE source_id = ?')
        .all('src-linkedin-ringcentral') as Array<{ id: string; is_active: number }>;
      expect(indexRows.length).toBe(vacancies.length);
      expect(indexRows[0]!.is_active).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists FaceApp (Corporate HTML) into SQLite pool according to production rules', async () => {
    const endpoint = CORPORATE_HTML_ENDPOINTS.find((e) => e.id === 'faceapp')!;
    const vacancies = await fetchCorporateHtmlVacancies(endpoint);
    expect(vacancies.length).toBeGreaterThan(0);

    const tempDir = mkdtempSync(join(tmpdir(), 'faceapp-ingest-'));
    const dbPath = join(tempDir, 'pool.db');

    try {
      const poolStore = new SqliteVacancyPoolStore({ databasePath: dbPath });
      poolStore.mergeSourceSlice('src-faceapp', vacancies);

      const db = new DatabaseSync(dbPath);
      const rows = db
        .prepare('SELECT id, source_id, payload FROM vacancy_pool WHERE source_id = ?')
        .all('src-faceapp') as Array<{ id: string; source_id: string; payload: string }>;
      expect(rows.length).toBe(vacancies.length);

      const firstPayload = JSON.parse(rows[0]!.payload);
      expect(firstPayload.company).toBe('FaceApp');
      expect(firstPayload.status).toBe('active');
      expect(firstPayload.url).toMatch(/^https:\/\/www\.faceapp\.com\/careers\//);
      expect(firstPayload.description.length).toBeGreaterThan(0);

      const indexRows = db
        .prepare('SELECT id, is_active FROM vacancy_pool_index WHERE source_id = ?')
        .all('src-faceapp') as Array<{ id: string; is_active: number }>;
      expect(indexRows.length).toBe(vacancies.length);
      expect(indexRows[0]!.is_active).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('persists DataDome (LinkedIn Guest) into SQLite pool without login credentials', async () => {
    const target = LINKEDIN_GROUP_B_TARGETS.find((t) => t.slug === 'datadome')!;
    const vacancies = await fetchLinkedinCompanyVacancies(target, { maxPages: 1 });
    expect(vacancies.length).toBeGreaterThan(0);

    const tempDir = mkdtempSync(join(tmpdir(), 'datadome-ingest-'));
    const dbPath = join(tempDir, 'pool.db');

    try {
      const poolStore = new SqliteVacancyPoolStore({ databasePath: dbPath });
      poolStore.mergeSourceSlice('src-linkedin-datadome', vacancies);

      const db = new DatabaseSync(dbPath);
      const rows = db
        .prepare('SELECT id, source_id, payload FROM vacancy_pool WHERE source_id = ?')
        .all('src-linkedin-datadome') as Array<{ id: string; source_id: string; payload: string }>;
      expect(rows.length).toBe(vacancies.length);

      const firstPayload = JSON.parse(rows[0]!.payload);
      expect(firstPayload.company).toBe('DataDome');
      expect(firstPayload.status).toBe('active');
      expect(firstPayload.url).toMatch(/^https:\/\/www\.linkedin\.com\/jobs\/view\/\d+/);

      const indexRows = db
        .prepare('SELECT id, is_active FROM vacancy_pool_index WHERE source_id = ?')
        .all('src-linkedin-datadome') as Array<{ id: string; is_active: number }>;
      expect(indexRows.length).toBe(vacancies.length);
      expect(indexRows[0]!.is_active).toBe(1);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
