import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { MemoryVacancyPoolStore } from './memoryVacancyPoolStore';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';
import { freshnessWindow } from './vacancyPoolQuery';
import type { VacancyPoolStore } from './vacancyPoolStore';

/**
 * B221 — пул читается из хранилища, а не из кучи. Две реализации обязаны
 * отвечать одинаково на одни и те же вопросы: тесты движка идут без базы, а
 * прод — с SQLite, и расхождение между ними никто бы не заметил до выката.
 */

const NOW = Date.parse('2026-09-15T12:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW = freshnessWindow(NOW);

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function vacancy(
  id: string,
  sourceId: string,
  overrides: Partial<UnifiedVacancy> = {},
): UnifiedVacancy {
  return {
    id,
    fingerprint: `fp-${id}`,
    title: `Role ${id}`,
    company: `Company ${id}`,
    isRemote: true,
    description: 'Description',
    requiredSkills: [],
    url: `https://example.test/${id}`,
    provenance: {
      sourceType: 'json_api',
      sourceId,
      sourceUrl: `https://example.test/${id}`,
      observedAt: daysAgo(1),
    },
    publishedAt: daysAgo(1),
    status: 'active',
    ...overrides,
  };
}

const directories: string[] = [];
const sqliteStores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  sqliteStores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function sqlite(): SqliteVacancyPoolStore {
  const directory = mkdtempSync(join(tmpdir(), 'pool-parity-'));
  directories.push(directory);
  const store = new SqliteVacancyPoolStore({ databasePath: join(directory, 'pool.db') });
  sqliteStores.push(store);
  return store;
}

const implementations: Array<[string, () => VacancyPoolStore]> = [
  ['memory', () => new MemoryVacancyPoolStore()],
  ['sqlite', sqlite],
];

function seed(store: VacancyPoolStore): void {
  store.replaceSourceSlice('board', [
    vacancy('b1', 'board', { title: 'Senior React Developer', company: 'Aurora' }),
    vacancy('b2', 'board', {
      title: 'Data Engineer',
      company: 'Borealis',
      isRemote: false,
      description: 'On site in Berlin',
      requiredSkills: ['Python'],
      publishedAt: daysAgo(3),
      status: 'archived',
    }),
    // Протухшая при чтении: свежесть считается на момент запроса, не записи.
    vacancy('b3', 'board', { title: 'Old', publishedAt: daysAgo(40) }),
    // Дата из будущего — не свежая: это ошибка площадки, а не новинка.
    vacancy('b4', 'board', { title: 'Future', publishedAt: daysAgo(-2) }),
  ]);
  store.replaceSourceSlice('channel', [
    vacancy('c1', 'channel', {
      title: 'Product Manager',
      company: 'Cirrus',
      publishedAt: daysAgo(2),
    }),
  ]);
}

describe.each(implementations)('VacancyPoolStore parity: %s', (_name, open) => {
  it('answers point lookups regardless of freshness', () => {
    const store = open();
    seed(store);
    expect(store.getVacancy('b1')?.title).toBe('Senior React Developer');
    expect(store.getVacancy('b3')?.title).toBe('Old');
    expect(store.getVacancy('missing')).toBeUndefined();
    expect(store.hasVacancy('c1')).toBe(true);
    expect(store.hasVacancy('missing')).toBe(false);
  });

  it('counts only fresh, unburied records', () => {
    const store = open();
    seed(store);
    expect(store.countVacancies(WINDOW)).toBe(3);
    expect(Object.fromEntries(store.countBySource(WINDOW))).toEqual({ board: 2, channel: 1 });
    store.markExpired(['b1'], daysAgo(0));
    expect(store.countVacancies(WINDOW)).toBe(2);
    expect(store.hasVacancy('b1')).toBe(false);
  });

  it('counts a source slice as stored, with its active share', () => {
    const store = open();
    seed(store);
    expect(store.countSourceSlice('board')).toEqual({ total: 4, active: 3 });
    expect(store.countSourceSlice('none')).toEqual({ total: 0, active: 0 });
  });

  it('pages newest first with a stable tie-break', () => {
    const store = open();
    seed(store);
    const page = store.queryVacancies({ window: WINDOW, offset: 0, limit: 2 });
    expect(page.total).toBe(3);
    expect(page.items.map((v) => v.id)).toEqual(['b1', 'c1']);
    const next = store.queryVacancies({ window: WINDOW, offset: 2, limit: 2 });
    expect(next.items.map((v) => v.id)).toEqual(['b2']);
  });

  it('filters by source, remote flag and substring across title, company, skills, description', () => {
    const store = open();
    seed(store);
    const ids = (query: Parameters<VacancyPoolStore['queryVacancies']>[0]) =>
      store.queryVacancies(query).items.map((v) => v.id);
    expect(ids({ window: WINDOW, sourceIds: ['channel'], offset: 0, limit: 10 })).toEqual(['c1']);
    expect(ids({ window: WINDOW, sourceIds: [], offset: 0, limit: 10 })).toEqual([]);
    expect(ids({ window: WINDOW, isRemote: false, offset: 0, limit: 10 })).toEqual(['b2']);
    expect(ids({ window: WINDOW, query: 'AURORA', offset: 0, limit: 10 })).toEqual(['b1']);
    expect(ids({ window: WINDOW, query: 'berlin', offset: 0, limit: 10 })).toEqual(['b2']);
    expect(ids({ window: WINDOW, query: 'python', offset: 0, limit: 10 })).toEqual(['b2']);
    expect(ids({ window: WINDOW, query: 'Разработчик', offset: 0, limit: 10 })).toEqual([]);
    expect(
      store.queryVacancies({ window: WINDOW, query: 'nothing', offset: 0, limit: 10 }).total,
    ).toBe(0);
  });

  it('matches Cyrillic case-insensitively', () => {
    const store = open();
    store.replaceSourceSlice('board', [vacancy('r1', 'board', { title: 'Старший Разработчик' })]);
    expect(
      store.queryVacancies({ window: WINDOW, query: 'разработчик', offset: 0, limit: 10 }).items,
    ).toHaveLength(1);
  });

  it('loads fresh vacancies for clustering and every stored one without a window', () => {
    const store = open();
    seed(store);
    expect(
      store
        .loadVacancies(WINDOW)
        .map((v) => v.id)
        .sort(),
    ).toEqual(['b1', 'b2', 'c1']);
    expect(
      store
        .loadVacancies()
        .map((v) => v.id)
        .sort(),
    ).toEqual(['b1', 'b2', 'b3', 'b4', 'c1']);
  });

  it('lists the links of one source without the payloads', () => {
    const store = open();
    seed(store);
    expect(store.loadSourceLinks('channel')).toEqual([
      { id: 'c1', url: 'https://example.test/c1' },
    ]);
  });

  it('merges a partial reading: updates the seen, keeps the unseen', () => {
    const store = open();
    seed(store);
    store.mergeSourceSlice('board', [
      vacancy('b1', 'board', { title: 'Renamed' }),
      vacancy('b5', 'board', { title: 'New' }),
    ]);
    expect(store.countSourceSlice('board').total).toBe(5);
    expect(store.getVacancy('b1')?.title).toBe('Renamed');
    expect(store.getVacancy('b2')?.title).toBe('Data Engineer');
    expect(store.getVacancy('b5')?.title).toBe('New');
    expect(store.countSourceSlice('channel').total).toBe(1);
  });

  it('drops records no tick observed since the sweep began (B219)', () => {
    const store = open();
    store.replaceSourceSlice('board', [
      vacancy('old', 'board', {
        provenance: { ...vacancy('old', 'board').provenance, observedAt: daysAgo(5) },
      }),
      vacancy('unknown', 'board', {
        provenance: { ...vacancy('unknown', 'board').provenance, observedAt: 'not-a-date' },
      }),
      vacancy('kept', 'board', {
        provenance: { ...vacancy('kept', 'board').provenance, observedAt: daysAgo(1) },
      }),
    ]);
    store.mergeSourceSlice(
      'board',
      [
        vacancy('fresh', 'board', {
          provenance: { ...vacancy('fresh', 'board').provenance, observedAt: daysAgo(0) },
        }),
      ],
      daysAgo(2),
    );
    expect(
      store
        .loadVacancies()
        .map((v) => v.id)
        .sort(),
    ).toEqual(['fresh', 'kept']);
  });

  it('keeps a buried record buried when a later reading carries it again', () => {
    const store = open();
    seed(store);
    store.markExpired(['b1'], daysAgo(0));
    store.mergeSourceSlice('board', [vacancy('b1', 'board')]);
    expect(store.hasVacancy('b1')).toBe(false);
    store.replaceSourceSlice('board', [vacancy('b1', 'board')]);
    expect(store.hasVacancy('b1')).toBe(false);
  });
  it('markExpired reports how many it buried and buries once', () => {
    const store = open();
    seed(store);
    expect(store.markExpired(['b1', 'missing'], daysAgo(0))).toBe(1);
    expect(store.markExpired(['b1'], daysAgo(0))).toBe(0);
    expect(store.markExpired([], daysAgo(0))).toBe(0);
  });

  it('prune drops stale readings and unknown sources, and wipes everything without sources', () => {
    const store = open();
    seed(store);
    store.saveSourceState({ sourceId: 'board', itemsFoundTotal: 1, itemsActiveTotal: 1 });
    store.saveSourceState({ sourceId: 'gone', itemsFoundTotal: 1, itemsActiveTotal: 1 });
    store.prune(['board'], daysAgo(30));
    expect(
      store
        .loadVacancies()
        .map((v) => v.id)
        .sort(),
    ).toEqual(['b1', 'b2', 'b4']);
    expect(store.countSourceSlice('channel').total).toBe(0);
    expect(store.loadSourceStates().map((s) => s.sourceId)).toEqual(['board']);
    store.prune([], daysAgo(30));
    expect(store.loadVacancies()).toEqual([]);
    expect(store.loadSourceStates()).toEqual([]);
  });

  it('streams the cluster input: fresh records as compact projections', () => {
    const store = open();
    store.replaceSourceSlice('board', [
      vacancy('b1', 'board', {
        description: `${'x'.repeat(400)} see https://boards.greenhouse.io/acme/jobs/123`,
        fullDescription: 'y'.repeat(5000),
        responsibilities: ['a'],
      }),
      vacancy('b3', 'board', { publishedAt: daysAgo(40) }),
    ]);
    const input = Array.from(store.iterateClusterInput(WINDOW));
    expect(input.map((v) => v.id)).toEqual(['b1']);
    const [projected] = input;
    expect(projected?.fullDescription).toBeUndefined();
    expect(projected?.responsibilities).toBeUndefined();
    // Сводка урезана до 300 знаков, но ATS-ссылка из хвоста текста сохранена.
    expect(projected?.description.length).toBeLessThan(400);
    expect(projected?.description).toContain('https://boards.greenhouse.io/acme/jobs/123');
    expect(projected?.title).toBe('Role b1');
  });

  it('keys the slice on the source it was written for, not on the payload', () => {
    const store = open();
    // Запись, чей текст называет другую площадку, принадлежит той, от чьего
    // имени записана — как `source_id` в базе.
    store.replaceSourceSlice('mirror', [vacancy('m1', 'board')]);
    expect(store.countSourceSlice('mirror').total).toBe(1);
    expect(store.countSourceSlice('board').total).toBe(0);
    expect(Object.fromEntries(store.countBySource(WINDOW))).toEqual({ mirror: 1 });
    expect(store.loadSourceLinks('mirror').map((l) => l.id)).toEqual(['m1']);
    expect(
      store.queryVacancies({ window: WINDOW, sourceIds: ['mirror'], offset: 0, limit: 5 }).total,
    ).toBe(1);
    store.replaceSourceSlice('mirror', []);
    expect(store.countSourceSlice('mirror').total).toBe(0);
  });
});
