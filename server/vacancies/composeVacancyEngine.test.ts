import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { composeVacancyEngine } from './composeVacancyEngine';

/**
 * B230: HTTP-процесс и обслуживатель собирают движок из одной фабрики. Если
 * наборы площадок разойдутся, админка покажет одно, а опросы пойдут по
 * другому — поэтому снимок конфигурации из двух сборок обязан совпадать.
 */
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

    const http = composeVacancyEngine({ databasePath, fetcher, recluster: { mode: 'sync' } });
    const maintenance = composeVacancyEngine({ databasePath, fetcher, recluster: { mode: 'off' } });

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
    const first = composeVacancyEngine({ databasePath, fetcher: async () => [] });
    first.close();
    const second = composeVacancyEngine({ databasePath, fetcher: async () => [] });
    expect(second.engine.poolSize).toBe(0);
    second.close();
  });
});
