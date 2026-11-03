import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  MIGRATION_35,
  VACANCY_CLUSTER_INPUT_TABLE,
  VACANCY_POOL_INDEX_TABLE,
} from '../data/sqliteSchema';
import type { FunctionCode } from '../../shared/roleTaxonomy';
import { careerGeographyOf } from './careerGeography';
import { matchGeographyOf } from './matchGeography';
import { buildSemanticMatchQuery } from './semanticMatchQuery';
import { clusterProjectionOf } from './vacancyPoolQuery';

const FUNCTIONS: FunctionCode[] = ['eng-mgmt', 'it-ops', 'ops', 'eng', 'product'];

interface Row {
  readonly id: string;
  readonly location: string;
  readonly isRemote?: boolean;
  readonly description?: string;
}

const ROWS: readonly Row[] = [
  { id: 'moscow', location: 'Москва' },
  { id: 'dubai', location: 'Dubai, United Arab Emirates' },
  { id: 'abu-dhabi', location: 'Abu Dhabi, United Arab Emirates' },
  { id: 'new-york', location: 'New York, NY' },
  { id: 'berlin', location: 'Berlin, Germany' },
  { id: 'troitsk', location: 'Троицк (Москва)' },
  { id: 'tashkent', location: 'Ташкент' },
  // Кавычки и обратная косая черта не ломают разбор места на части.
  { id: 'quoted', location: 'Москва, БЦ "Сити" \\ башня' },
  { id: 'remote-global', location: 'Remote', isRemote: true },
  {
    id: 'remote-us',
    location: 'Remote',
    isRemote: true,
    description: 'This role can work remotely anywhere in the US.',
  },
];

function seeded(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec(MIGRATION_35);
  database.exec(VACANCY_POOL_INDEX_TABLE);
  database.exec(VACANCY_CLUSTER_INPUT_TABLE);
  ROWS.forEach((row, index) => {
    const published = 1_000 + index;
    database
      .prepare(
        'INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote) VALUES (?,?,?,?,?,?)',
      )
      .run(row.id, 'eng-mgmt', 3, `title-${row.id}`, published, row.isRemote ? 1 : 0);
    database
      .prepare(
        'INSERT INTO vacancy_pool_index (id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired) VALUES (?,?,?,?,1,?,?,?,0)',
      )
      .run(
        row.id,
        'src',
        published,
        published,
        row.isRemote ? 1 : 0,
        `https://x/${row.id}`,
        row.id,
      );
    const projection = clusterProjectionOf({
      id: row.id,
      fingerprint: row.id,
      title: 'Head of Engineering',
      company: 'Acme',
      location: row.location,
      isRemote: row.isRemote ?? false,
      description: row.description ?? '',
      requiredSkills: [],
      url: `https://x/${row.id}`,
      provenance: { sourceId: 'src', observedAt: '2026-11-01T00:00:00.000Z' } as never,
      publishedAt: '2026-11-01T00:00:00.000Z',
      status: 'active',
    });
    const stored = projection;
    database
      .prepare('INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)')
      .run(row.id, JSON.stringify(stored));
  });
  return database;
}

function selectedIds(database: DatabaseSync, searchLocations: string[]): string[] {
  const geography = matchGeographyOf(careerGeographyOf({ searchLocations }));
  const { sql, params } = buildSemanticMatchQuery({
    functionCodes: FUNCTIONS,
    levelRank: 3,
    geography,
    window: { fromMs: 0, toMs: 5_000 },
    preferRemote: false,
    limit: 50,
  });
  return (database.prepare(sql).all(...params) as Array<{ payload: string }>)
    .map((row) => (JSON.parse(row.payload) as { id: string }).id)
    .sort();
}

describe('place filter depth (03.11, after #354 and #367)', () => {
  it.each([
    [['Москва', 'США']],
    [['Москва', 'Россия']],
    [['Москва', 'ОАЭ', 'Удалённо из РФ']],
    [['Москва', 'Россия', 'США', 'Германия', 'ОАЭ', 'Казахстан', 'Удалённо из РФ']],
  ])('%j runs on real SQLite without «Expression tree is too large»', (places) => {
    const database = seeded();
    expect(() => selectedIds(database, places)).not.toThrow();
    const geography = matchGeographyOf(careerGeographyOf({ searchLocations: places }));
    const { params } = buildSemanticMatchQuery({
      functionCodes: FUNCTIONS,
      levelRank: 3,
      geography,
      window: { fromMs: 0, toMs: 5_000 },
      preferRemote: false,
      limit: 50,
    });
    // #354 гнал 1 676 параметров; написания и области — по одному JSON на ветку.
    expect(params.length).toBeLessThan(FUNCTIONS.length * 20);
  });
});

describe('a country beside a city does not narrow the selection', () => {
  it('adding «ОАЭ» keeps every Moscow row and adds the Emirates', () => {
    const database = seeded();
    const before = selectedIds(database, ['Москва', 'Удалённо из РФ']);
    const after = selectedIds(database, ['Москва', 'Удалённо из РФ', 'ОАЭ']);
    expect(before).toEqual(['moscow', 'quoted', 'remote-global', 'troitsk']);
    expect(after).toEqual(expect.arrayContaining(before));
    expect(after).toEqual(expect.arrayContaining(['abu-dhabi', 'dubai']));
    expect(after).not.toContain('new-york');
    expect(after).not.toContain('remote-us');
  });
});

describe('a place matches by whole parts, not substrings (03.11)', () => {
  it('«Троицк (Москва)» is Moscow; «Ташкент» is not a US «Кент»', () => {
    const ids = selectedIds(seeded(), ['Москва', 'США']);
    expect(ids).toEqual(expect.arrayContaining(['moscow', 'new-york', 'troitsk']));
    expect(ids).not.toContain('tashkent');
    expect(ids).not.toContain('berlin');
  });
});
