import { describe, expect, it } from 'vitest';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import {
  normalizeAtsBoard,
  atsBoardSourceId,
  type AtsProvider,
} from './atsBoardAdapters';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

describe('ATS Production Ingestion Gate (Subgroup 4.1)', () => {
  const atsTestCases: Array<{
    provider: AtsProvider;
    board: string;
    company: string;
    url: string;
  }> = [
    {
      provider: 'ashby',
      board: 'cyberhaven',
      company: 'Cyberhaven',
      url: 'https://api.ashbyhq.com/posting-api/job-board/cyberhaven',
    },
    {
      provider: 'lever',
      board: 'airslate',
      company: 'airSlate',
      url: 'https://api.lever.co/v0/postings/airslate?mode=json',
    },
    {
      provider: 'greenhouse',
      board: 'boosta',
      company: 'Boosta',
      url: 'https://boards-api.greenhouse.io/v1/boards/boosta/jobs?content=true',
    },
    {
      provider: 'smartrecruiters',
      board: 'Influ2',
      company: 'Influ2',
      url: 'https://api.smartrecruiters.com/v1/companies/Influ2/postings?limit=100',
    },
    {
      provider: 'workable',
      board: 'trinetix',
      company: 'Trinetix',
      url: 'https://apply.workable.com/api/v1/widget/accounts/trinetix?details=true',
    },
    {
      provider: 'breezy',
      board: 'leobit',
      company: 'Leobit',
      url: 'https://leobit.breezy.hr/json',
    },
    {
      provider: 'recruitee',
      board: 'brainstack',
      company: 'Brainstack',
      url: 'https://brainstack.recruitee.com/api/offers/',
    },
  ];

  it('normalizes vacancies across all 7 ATS platforms and ingests them cleanly into SQLite pool', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'ats-ingest-'));
    const dbPath = join(tempDir, 'pool.db');

    try {
      const poolStore = new SqliteVacancyPoolStore({ databasePath: dbPath });
      const db = new DatabaseSync(dbPath);

      for (const tc of atsTestCases) {
        const sourceId = atsBoardSourceId(tc.provider, tc.board);
        const res = await fetch(tc.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; openqareer/1.0; +https://openqareer.com)',
          },
        });
        expect(res.status, `Failed fetching ${tc.company} (${tc.url})`).toBe(200);

        const payload = await res.json();
        const vacancies = normalizeAtsBoard(sourceId, payload, {
          sourceName: tc.company,
          observedAt: '2026-11-05',
        });

        expect(vacancies.length, `Expected at least 1 vacancy for ${tc.company}`).toBeGreaterThan(0);

        // Production rule validations for every vacancy
        for (const v of vacancies) {
          expect(v.id).toBeTruthy();
          expect(v.title).toBeTruthy();
          expect(v.company).toBeTruthy();
          expect(v.url).toMatch(/^https?:\/\//);
          expect(v.status).toBe('active');
          expect(v.provenance.sourceId).toBe(sourceId);
        }

        // Ingest slice into SQLite pool
        poolStore.mergeSourceSlice(sourceId, vacancies);

        const expectedUniqueCount = new Set(vacancies.map((v) => v.id)).size;
        expect(expectedUniqueCount).toBeGreaterThan(0);

        // Verify in SQLite vacancy_pool table
        const rows = db
          .prepare(
            'SELECT id, source_id, payload FROM vacancy_pool WHERE source_id = ?',
          )
          .all(sourceId) as Array<{ id: string; source_id: string; payload: string }>;
        expect(rows.length).toBe(expectedUniqueCount);

        // Verify in SQLite vacancy_pool_index table
        const indexRows = db
          .prepare(
            'SELECT id, is_active FROM vacancy_pool_index WHERE source_id = ?',
          )
          .all(sourceId) as Array<{ id: string; is_active: number }>;
        expect(indexRows.length).toBe(expectedUniqueCount);
        expect(indexRows[0]!.is_active).toBe(1);
      }
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 45000);
});
