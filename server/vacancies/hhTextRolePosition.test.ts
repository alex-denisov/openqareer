import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { UnifiedVacancy, VacancyCluster } from '../domain/unifiedVacancy';
import { HhCatalogTextBackfill, type HhCatalogTextEngine } from './hhCatalogText';
import { HH_TEXT_ROLE_REST_MS } from './hhTextRolePosition';
import { SqliteVacancyPoolStore } from './sqliteVacancyPoolStore';

const HH = 'src-hh-search';
const directories: string[] = [];
const stores: SqliteVacancyPoolStore[] = [];

afterEach(() => {
  stores.splice(0).forEach((store) => store.close());
  directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

function open(): { store: SqliteVacancyPoolStore; path: string } {
  const directory = mkdtempSync(join(tmpdir(), 'hh-role-position-'));
  directories.push(directory);
  const path = join(directory, 'pool.db');
  const store = new SqliteVacancyPoolStore({ databasePath: path });
  stores.push(store);
  return { store, path };
}

function hh(n: number, daysAgo: number, fullDescription?: string): UnifiedVacancy {
  const id = `${HH}:${n}`;
  const url = `https://hh.ru/vacancy/${n}`;
  const at = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  return {
    id,
    fingerprint: id,
    title: `Роль ${n}`,
    company: 'Компания',
    location: 'Москва',
    description: '',
    ...(fullDescription ? { fullDescription } : {}),
    requiredSkills: [],
    url,
    provenance: { sourceType: 'hh_search', sourceId: HH, sourceUrl: url, observedAt: at },
    publishedAt: at,
    status: 'active',
  };
}

function clusterOf(vacancy: UnifiedVacancy): VacancyCluster {
  return {
    id: `cluster-${vacancy.id}`,
    canonicalTitle: 'Senior Data Analyst',
    canonicalCompany: vacancy.company,
    canonicalLocation: 'Moscow',
    isRemote: false,
    salary: { from: 200000, to: 300000, currency: 'RUR' },
    descriptionSummary: '',
    skills: [],
    primaryUrl: vacancy.url,
    sources: [vacancy.provenance],
    firstObservedAt: vacancy.publishedAt,
    lastSeenAt: new Date().toISOString(),
    status: 'active',
    vacanciesCount: 1,
  };
}

function classify(path: string, rows: Array<[UnifiedVacancy, string, number | null]>): void {
  const writer = new DatabaseSync(path);
  const insert = writer.prepare(
    `INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote)
     VALUES (?, ?, ?, ?, ?, 0)`,
  );
  for (const [vacancy, code, level] of rows) {
    insert.run(vacancy.id, code, level, vacancy.id, Date.parse(vacancy.publishedAt));
  }
  writer.close();
}

describe('hh role text position (04.11)', () => {
  it('walks the functions and levels of every target newest first, one id at a time', () => {
    const { store, path } = open();
    const [cto, cio, junior, cook, qa, withText] = [
      hh(1, 3),
      hh(2, 20),
      hh(3, 1),
      hh(4, 0),
      hh(5, 5),
      hh(6, 2, 'Полный текст вакансии'),
    ];
    store.mergeSourceSlice(HH, [cto, cio, junior, cook, qa, withText]);
    classify(path, [
      [cto, 'eng', 6],
      [cio, 'eng', null],
      [junior, 'eng', 1],
      [cook, 'hospitality', 1],
      [qa, 'qa', 1],
      [withText, 'eng', 6],
    ]);
    store.recordHhTextRoleTarget('a', ['eng'], 4);
    store.recordHhTextRoleTarget('b', ['qa'], null);
    const seen: string[] = [];
    let position: string | undefined;
    for (let tick = 0; tick < 5; tick += 1) {
      const page = store.loadHhRoleTextCandidates(position, 1);
      seen.push(...page.ids);
      position = page.position;
    }
    expect(seen).toEqual([cto.id, qa.id, cio.id]);
  });

  it('rests after a whole pass, then starts from the newest rows again', () => {
    const { store, path } = open();
    const row = hh(1, 1);
    store.mergeSourceSlice(HH, [row]);
    classify(path, [[row, 'eng', 3]]);
    store.recordHhTextRoleTarget('a', ['eng'], null);
    const now = Date.now();
    const first = store.loadHhRoleTextCandidates(undefined, 5, now);
    expect(first.ids).toEqual([row.id]);
    const end = store.loadHhRoleTextCandidates(first.position, 5, now);
    expect(end.ids).toEqual([]);
    const resting = store.loadHhRoleTextCandidates(end.position, 5, now + 1_000);
    expect(resting.ids).toEqual([]);
    const later = store.loadHhRoleTextCandidates(resting.position, 5, now + HH_TEXT_ROLE_REST_MS + 1);
    expect(later.ids).toEqual([row.id]);
  });

  it('keeps its position in the database, apart from the catalog walk', () => {
    const { store, path } = open();
    const [role, catalog] = [hh(1, 1), hh(2, 2)];
    store.mergeSourceSlice(HH, [role, catalog]);
    store.saveClusters([catalog].map(clusterOf));
    classify(path, [[role, 'eng', 3]]);
    store.recordHhTextRoleTarget('a', ['eng'], null);
    expect(store.loadHhRoleTextPosition()).toBeUndefined();
    store.saveHhRoleTextPosition('123|key');
    expect(store.loadHhRoleTextPosition()).toBe('123|key');
    // The general walk no longer has a role phase: it starts at the catalog.
    expect(store.loadHhTextCandidates(undefined, 1).ids).toEqual([catalog.id]);
    expect(store.loadHhTextCandidates('role|5|old', 1).ids).toEqual([catalog.id]);
  });

  it('has no ids without a target', () => {
    const { store } = open();
    store.mergeSourceSlice(HH, [hh(1, 1)]);
    expect(store.loadHhRoleTextCandidates(undefined, 5).ids).toEqual([]);
  });
});

describe('HhCatalogTextBackfill role position (04.11)', () => {
  const engineWith = (over: Partial<HhCatalogTextEngine>): HhCatalogTextEngine => ({
    hhTextReady: () => true,
    loadHhTextCandidates: () => ({ ids: ['pool'] }),
    loadVacancyDescription: async () => ({ status: 'loaded', unavailable: false }),
    ...over,
  });

  it('runs first on every tick while the general walk keeps its place', async () => {
    const loaded: string[] = [];
    const saved: Array<string | undefined> = [];
    const generalSaved: Array<string | undefined> = [];
    const pages = [{ ids: ['r1'], position: 'p1' }, { ids: ['r2'], position: 'p2' }, { ids: [], position: 'p3' }];
    const backfill = new HhCatalogTextBackfill({
      perTick: 5,
      engine: engineWith({
        loadRoleCandidates: () => pages.shift() ?? { ids: [], position: 'p3' },
        saveRolePosition: (position) => saved.push(position),
        saveCursor: (cursor) => generalSaved.push(cursor),
        loadVacancyDescription: async (id) => {
          loaded.push(id);
          return { status: 'loaded', unavailable: false };
        },
      }),
    });
    await backfill.step();
    await backfill.step();
    expect(generalSaved).toEqual([]);
    await backfill.step();
    expect(loaded).toEqual(['r1', 'r2', 'pool']);
    expect(saved).toEqual(['p1', 'p2', 'p3']);
    expect(generalSaved).toHaveLength(1);
  });

  it('a candidate selection still goes before the role position', async () => {
    const loaded: string[] = [];
    const backfill = new HhCatalogTextBackfill({
      perTick: 5,
      engine: engineWith({
        peekPriority: () => ['selected'],
        dropPriority: () => undefined,
        loadRoleCandidates: () => ({ ids: ['role'], position: 'p' }),
        loadVacancyDescription: async (id) => {
          loaded.push(id);
          return { status: 'loaded', unavailable: false };
        },
      }),
    });
    await backfill.step();
    expect(loaded).toEqual(['selected']);
  });

  it('a refused tick keeps the role position, so the rows are read again', async () => {
    const saved: string[] = [];
    const backfill = new HhCatalogTextBackfill({
      perTick: 5,
      engine: engineWith({
        loadRoleCandidates: () => ({ ids: ['r1'], position: 'p1' }),
        saveRolePosition: (position) => saved.push(position),
        loadVacancyDescription: async () => ({ status: 'failed', unavailable: false, blocked: 'refused' }),
      }),
    });
    expect((await backfill.step()).blocked).toBe(true);
    expect(saved).toEqual([]);
  });
});
