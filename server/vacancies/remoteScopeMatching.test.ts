import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  MIGRATION_35,
  VACANCY_CLUSTER_INPUT_TABLE,
  VACANCY_POOL_INDEX_TABLE,
} from '../data/sqliteSchema';
import { careerGeographyOf, withinCareerGeography } from './careerGeography';
import { matchGeographyKey, matchGeographyOf } from './matchGeography';
import { buildSemanticMatchQuery } from './semanticMatchQuery';
import { remoteCountryFit } from './vacancyGeography';

const fromRussia = careerGeographyOf({ searchLocations: ['Москва', 'Удалённо из РФ'] })!;
const remoteAnywhere = careerGeographyOf({ searchLocations: ['Москва', 'Удалённо'] })!;

const remote = (remoteScope?: string, canonicalLocation = 'Remote') => ({
  cluster: { isRemote: true, canonicalLocation, ...(remoteScope ? { remoteScope } : {}) },
});

describe('«Удалённо из РФ» against the remote scope (03.11)', () => {
  it('takes global remote and scopes that include Russia', () => {
    expect(withinCareerGeography(remote('global'), fromRussia)).toBe(true);
    expect(withinCareerGeography(remote('RU'), fromRussia)).toBe(true);
    expect(withinCareerGeography(remote('EMEA'), fromRussia)).toBe(true);
  });

  it('does not take US-only remote', () => {
    expect(withinCareerGeography(remote('US'), fromRussia)).toBe(false);
  });

  it('keeps the old rule while the scope is not computed yet', () => {
    expect(withinCareerGeography(remote(undefined), fromRussia)).toBe(true);
  });

  it('remote without a country takes every scope', () => {
    expect(remoteAnywhere.remoteRegions).toEqual([]);
    expect(withinCareerGeography(remote('US'), remoteAnywhere)).toBe(true);
  });
});

describe('remote country mark uses the scope', () => {
  it('global remote is a match, not «страна не указана»', () => {
    expect(remoteCountryFit(remote('global').cluster, ['ru'])).toBeUndefined();
  });

  it('TIDI «Remote» + «anywhere in the US» is another country', () => {
    expect(remoteCountryFit(remote('US').cluster, ['ru'])).toBe('other');
  });

  it('without a scope the location still decides', () => {
    expect(remoteCountryFit(remote(undefined).cluster, ['ru'])).toBe('unknown');
  });
});

describe('SQL selection reads the stored scope', () => {
  function seededDatabase(): DatabaseSync {
    const database = new DatabaseSync(':memory:');
    database.exec(MIGRATION_35);
    database.exec(VACANCY_POOL_INDEX_TABLE);
    database.exec(VACANCY_CLUSTER_INPUT_TABLE);
    const rows: Array<[string, string, string | undefined]> = [
      ['us-only', 'Remote', 'US'],
      ['global', 'Remote', 'global'],
      ['emea', 'Remote', 'EMEA'],
      ['not-computed', 'Remote', undefined],
    ];
    rows.forEach(([id, location, remoteScope], index) => {
      database
        .prepare(
          'INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote) VALUES (?,?,?,?,?,1)',
        )
        .run(id, 'eng-mgmt', 3, `title-${id}`, 1_000 + index);
      database
        .prepare(
          'INSERT INTO vacancy_pool_index (id, source_id, published_ms, observed_ms, is_active, is_remote, url, search_text, expired) VALUES (?,?,?,?,1,1,?,?,0)',
        )
        .run(id, 'src', 1_000 + index, 1_000, `https://x/${id}`, id);
      database
        .prepare('INSERT INTO vacancy_cluster_input (id, cluster_json) VALUES (?, ?)')
        .run(id, JSON.stringify({ id, location, ...(remoteScope ? { remoteScope } : {}) }));
    });
    return database;
  }

  it('«Удалённо из РФ» does not spend the read window on US-only remote', () => {
    const database = seededDatabase();
    const { sql, params } = buildSemanticMatchQuery({
      functionCodes: ['eng-mgmt'],
      levelRank: 3,
      geography: matchGeographyOf(fromRussia),
      window: { fromMs: 0, toMs: 5_000 },
      preferRemote: false,
      limit: 50,
    });
    const ids = (database.prepare(sql).all(...params) as Array<{ payload: string }>).map(
      (row) => (JSON.parse(row.payload) as { id: string }).id,
    );
    expect(ids.sort()).toEqual(['emea', 'global', 'not-computed']);
  });

  it('the snapshot key changes with the remote areas', () => {
    expect(matchGeographyKey(matchGeographyOf(fromRussia))).not.toBe(
      matchGeographyKey(matchGeographyOf(remoteAnywhere)),
    );
  });
});
