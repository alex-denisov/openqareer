import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

/**
 * B230: куча обслуживателя на 100 000 синтетических записей партиями по 500
 * остаётся ниже 300 МБ. Это спецификация из тикета, а не оптимизация: именно
 * полная пересборка на пуле такого размера дважды откатывала B221.
 */
const TOTAL = 100_000;
const SOURCES = 20;
const HEAP_BUDGET_MB = 300;

function source(index: number): VacancySourceConfig {
  return {
    id: `synthetic-${index}`,
    name: `Synthetic ${index}`,
    type: 'json_api',
    enabled: true,
    targetUrl: `https://synthetic-${index}.example/jobs`,
    refreshIntervalMinutes: 60,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

/** Словарь как у настоящих работодателей: токен встречается у десятков, не у всех. */
const WORDS = Array.from({ length: 6_000 }, (_, i) => `w${i.toString(36)}q`);
function companyName(serial: number): string {
  const a = WORDS[(serial * 7) % WORDS.length]!;
  const b = WORDS[(serial * 131 + 5) % WORDS.length]!;
  return `${a} ${b} ${(serial % 3000).toString(36)}`;
}

function* reading(sourceIndex: number): Generator<UnifiedVacancy> {
  const perSource = TOTAL / SOURCES;
  for (let i = 0; i < perSource; i += 1) {
    const serial = sourceIndex * perSource + i;
    // Каждая десятая — дубль записи соседней площадки по ссылке.
    const twin = i % 10 === 0 && sourceIndex > 0 ? serial - perSource : serial;
    const url = `https://jobs.example/${twin}`;
    yield {
      id: `s${sourceIndex}:${serial}`,
      fingerprint: `fp-${serial}`,
      // Номер фиксированной ширины: «engineer 12» иначе вкладывается в «engineer 123».
      title: `${['Backend', 'Frontend', 'Data', 'QA'][serial % 4]} Engineer ${serial.toString().padStart(6, '0')} ${(serial * 31).toString(36).padStart(5, 'x')}`,
      company: companyName(serial % 3000),
      description: 'Lorem ipsum dolor sit amet '.repeat(12),
      requiredSkills: ['TypeScript', 'SQL'],
      url,
      provenance: {
        sourceType: 'json_api',
        sourceId: `synthetic-${sourceIndex}`,
        sourceUrl: `${url}?src=${sourceIndex}`,
        observedAt: new Date().toISOString(),
      },
      publishedAt: new Date().toISOString(),
      status: 'active',
    };
  }
}

/**
 * Полторы-две минуты на 100 000 записей: не для каждого прогона. Включается
 * `OPENQAREER_HEAVY_TESTS=1` (см. DEPLOY.md, «Verification gate»).
 */
const heavy = process.env.OPENQAREER_HEAVY_TESTS === '1' ? describe : describe.skip;

heavy('keyed clustering heap budget (B230)', () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  it(`stays under ${HEAP_BUDGET_MB} MB heap for ${TOTAL} records in batches of 500`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'keyed-heap-'));
    directories.push(directory);
    const pool = new SqliteVacancyPoolStore({ databasePath: join(directory, 'db.sqlite') });
    const engine = new MultiSourceVacancyEngine({
      sources: Array.from({ length: SOURCES }, (_, i) => source(i)),
      pool,
      fetcher: async (s) => Array.from(reading(Number(s.id.slice('synthetic-'.length)))),
      recluster: { mode: 'keyed', batchSize: 500 },
    });

    let peakHeapMb = 0;
    const sample = () => {
      peakHeapMb = Math.max(peakHeapMb, process.memoryUsage().heapUsed / (1024 * 1024));
    };
    const sampler = setInterval(sample, 50);
    const startedAt = Date.now();
    try {
      for (let i = 0; i < SOURCES; i += 1) {
        await engine.syncSource(`synthetic-${i}`);
        sample();
      }
    } finally {
      clearInterval(sampler);
    }
    const elapsedMs = Date.now() - startedAt;

    expect(engine.poolSize).toBe(TOTAL);
    expect(engine.clusterRebuildCount).toBe(0);
    expect(pool.countClusters()).toBeLessThan(TOTAL);
    expect(pool.countClusters()).toBeGreaterThan(TOTAL * 0.8);
    console.info(
      `keyed heap: peak ${peakHeapMb.toFixed(0)} MB, ${elapsedMs} ms, clusters ${pool.countClusters()}`,
    );
    expect(peakHeapMb).toBeLessThan(HEAP_BUDGET_MB);
    pool.close();
  }, 300_000);
});
