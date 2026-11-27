import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeVacancyEngine, refreshCompanyChannelsAsync } from './composeVacancyEngine';
import { COMPANY_DIRECTORY_MIGRATION } from '../data/companyDirectorySchema';

/**
 * B230: HTTP-процесс и обслуживатель собирают движок из одной фабрики. Если
 * наборы площадок разойдутся, админка покажет одно, а опросы пойдут по
 * другому — поэтому снимок конфигурации из двух сборок обязан совпадать.
 */
/** Тесты не ходят за robots.txt: «не подтверждено» — площадка опрашивается. */
const offline = async () => ({ status: 0, body: null });

describe('composeVacancyEngine (B230)', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it('two processes on one database see the same sources and fetcher wiring', () => {
    const directory = mkdtempSync(join(tmpdir(), 'compose-engine-'));
    directories.push(directory);
    const databasePath = join(directory, 'db.sqlite');
    const fetcher = async () => [];

    const http = composeVacancyEngine({
      databasePath,
      fetchRobots: offline,
      fetcher,
      recluster: { mode: 'sync' },
    });
    const maintenance = composeVacancyEngine({
      databasePath,
      fetchRobots: offline,
      fetcher,
      recluster: { mode: 'off' },
    });

    const snapshot = (sources: ReturnType<typeof http.engine.getSources>) =>
      sources.map((s) => ({ id: s.id, type: s.type, enabled: s.enabled, url: s.targetUrl }));
    expect(snapshot(maintenance.engine.getSources())).toEqual(snapshot(http.engine.getSources()));
    expect(http.engine.getSources().length).toBeGreaterThan(0);
    // Настройки обхода hh.ru читаются из той же базы.
    expect(maintenance.hhCrawlSettings.read()).toEqual(http.hhCrawlSettings.read());

    http.close();
    maintenance.close();
  });

  it('close releases the pool store so the file can be reopened', () => {
    const directory = mkdtempSync(join(tmpdir(), 'compose-engine-'));
    directories.push(directory);
    const databasePath = join(directory, 'db.sqlite');
    const first = composeVacancyEngine({
      databasePath,
      fetchRobots: offline,
      fetcher: async () => [],
    });
    first.close();
    const second = composeVacancyEngine({
      databasePath,
      fetchRobots: offline,
      fetcher: async () => [],
    });
    expect(second.engine.poolSize).toBe(0);
    second.close();
  });

  it('refreshes new and removed company_directory channels without restart (Phase 0)', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'compose-refresh-'));
    directories.push(directory);
    const databasePath = join(directory, 'db.sqlite');
    const db = new DatabaseSync(databasePath);
    db.exec(COMPANY_DIRECTORY_MIGRATION);
    db.close();

    const composed = composeVacancyEngine({
      databasePath,
      fetchRobots: offline,
      fetcher: async () => [],
    });
    expect(composed.engine.getSources().some((s) => s.id === 'src-company-li-core42')).toBe(false);

    const writer = new DatabaseSync(databasePath);
    writer
      .prepare(
        `INSERT INTO company_directory (
           company_key, company_name, website_url, careers_url, linkedin_url,
           linkedin_org_id, source_type, status, created_at, updated_at
         ) VALUES ('core42', 'Core42', 'https://www.core42.ai/', 'https://www.linkedin.com/company/core42ai/jobs/',
                   'https://www.linkedin.com/company/core42ai/jobs/', '20800', 'linkedin_guest', 'active', '2026-11-27T00:00:00Z', '2026-11-27T00:00:00Z')`,
      )
      .run();

    const added = await refreshCompanyChannelsAsync(databasePath, composed.engine);
    expect(added.added).toBe(1);
    expect(
      composed.engine.getSources().find((s) => s.id === 'src-company-li-core42')?.enabled,
    ).toBe(true);

    writer.prepare(`UPDATE company_directory SET status = 'dormant' WHERE company_key = 'core42'`).run();
    writer.close();

    const disabled = await refreshCompanyChannelsAsync(databasePath, composed.engine);
    expect(disabled.disabled).toBe(1);
    expect(
      composed.engine.getSources().find((s) => s.id === 'src-company-li-core42')?.enabled,
    ).toBe(false);

    composed.close();
  });
});
