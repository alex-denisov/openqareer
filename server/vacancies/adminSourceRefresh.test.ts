import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';
import { adminSourceWindow, ADMIN_SOURCE_WINDOW } from './adminSourcePage';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { emptySourceObservations } from './sourceHealthVerdict';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

/**
 * B736: на проде в `vacancy_source_state` 76 275 строк и 55 МБ наблюдений. Каждая
 * страница `GET /api/v1/admin/vacancy-sources` перечитывала их все и считала срез
 * каждой нездоровой площадки — ~3,4 с синхронно, сервер стоял для всех (20.11).
 * Страница освежает только свои площадки.
 */

const STORED = 30_000;
const REGISTERED = 400;
const BUDGET_MS = 300;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function source(index: number): VacancySourceConfig {
  return {
    id: `src-${String(index).padStart(5, '0')}`,
    name: `Площадка ${index}`,
    type: 'rss',
    enabled: true,
    targetUrl: `https://example.test/${index}`,
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

/** Состояния пишутся одной транзакцией в обход хранилища: так быстрее засеять 30 000. */
function seedStates(databasePath: string): void {
  const observations = JSON.stringify({
    ...emptySourceObservations(),
    firstReadingAt: '2026-11-01T00:00:00.000Z',
    lastReadingAt: '2026-11-20T00:00:00.000Z',
    windowReadings: 40,
    census: { note: 'x'.repeat(600) },
  });
  const db = new DatabaseSync(databasePath);
  const insert = db.prepare(
    `INSERT INTO vacancy_source_state (source_id, last_status, items_found_total,
       items_active_total, observations) VALUES (?, ?, ?, ?, ?)`,
  );
  db.exec('BEGIN');
  for (let index = 0; index < STORED; index += 1) {
    insert.run(source(index).id, index % 3 === 0 ? 'error' : 'healthy', 10, 5, observations);
  }
  db.exec('COMMIT');
  db.close();
}

function setFound(databasePath: string, sourceId: string, found: number): void {
  const db = new DatabaseSync(databasePath);
  db.prepare(
    `UPDATE vacancy_source_state SET items_found_total = ?, last_status = 'healthy'
      WHERE source_id = ?`,
  ).run(found, sourceId);
  db.close();
}

function rig() {
  const dir = mkdtempSync(join(tmpdir(), 'b736-'));
  dirs.push(dir);
  const databasePath = join(dir, 'pool.db');
  const pool = new SqliteVacancyPoolStore({ databasePath });
  seedStates(databasePath);
  const sources = Array.from({ length: REGISTERED }, (_, index) => source(index));
  const engine = new MultiSourceVacancyEngine({ sources, pool, fetcher: async () => [] });
  return { databasePath, pool, engine, sources };
}

describe('B736 · страница площадок освежает только своё окно', () => {
  it('окно страницы — площадки от смещения, не больше потолка', () => {
    const sorted = Array.from({ length: 500 }, (_, index) => source(index));
    expect(adminSourceWindow(sorted, 0).map((item) => item.id)).toEqual(
      sorted.slice(0, ADMIN_SOURCE_WINDOW).map((item) => item.id),
    );
    expect(adminSourceWindow(sorted, 480)).toHaveLength(20);
    expect(adminSourceWindow(sorted, -5)[0]?.id).toBe(sorted[0]?.id);
  });

  it(`освежение окна укладывается в ${BUDGET_MS} мс при ${STORED} сохранённых состояниях`, () => {
    const { databasePath, pool, engine, sources } = rig();
    const window = sources.slice(0, ADMIN_SOURCE_WINDOW).map((item) => item.id);
    const outside = sources[REGISTERED - 1]!.id;
    setFound(databasePath, window[0]!, 777);
    setFound(databasePath, outside, 888);
    const load = vi.spyOn(pool, 'loadSourceStates');

    const started = performance.now();
    engine.refreshPersistedSourceState(window);
    const elapsed = performance.now() - started;

    expect(elapsed).toBeLessThan(BUDGET_MS);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith(window);
    expect(engine.getSource(window[0]!)?.itemsFoundTotal).toBe(777);
    expect(engine.getSource(outside)?.itemsFoundTotal).not.toBe(888);
  });

  it('хранилище по списку отдаёт только названные площадки', () => {
    const { pool } = rig();
    const ids = [source(1).id, source(29_999).id, 'not-stored'];
    expect(
      pool
        .loadSourceStates(ids)
        .map((state) => state.sourceId)
        .sort(),
    ).toEqual([source(1).id, source(29_999).id]);
    expect(pool.loadSourceStates([])).toEqual([]);
  });
});
