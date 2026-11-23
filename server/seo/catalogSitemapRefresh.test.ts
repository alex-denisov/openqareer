import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeCatalogSitemaps } from './catalogSitemapJob';
import {
  getCatalogSitemaps,
  resetCatalogSitemaps,
  scheduleCatalogSitemapRefresh,
} from './catalogSitemapSchedule';

let dir = '';

afterEach(() => {
  resetCatalogSitemaps();
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
});

function databaseWithSitemaps(): string {
  dir = mkdtempSync(join(tmpdir(), 'oq-b776-'));
  const path = join(dir, 'db.sqlite');
  const database = new DatabaseSync(path);
  writeCatalogSitemaps(
    database,
    [{ name: 'jobs-1.xml', xml: '<a/>', urlCount: 1 }],
    new Date('2026-11-23T08:00:00Z'),
  );
  database.close();
  return path;
}

describe('B776: обновление карт сайта в веб-процессе отдаёт цикл событий между шагами', () => {
  it('таймер не держит цикл до конца чтения: файлы появляются после такта', async () => {
    const log = { info: vi.fn(), error: vi.fn() };
    const stop = scheduleCatalogSitemapRefresh(databaseWithSitemaps(), log);
    expect(getCatalogSitemaps()).toBeNull();
    await vi.waitFor(() =>
      expect(getCatalogSitemaps()?.map((file) => file.name)).toEqual(['jobs-1.xml']),
    );
    expect(log.error).not.toHaveBeenCalled();
    stop();
  });
});
