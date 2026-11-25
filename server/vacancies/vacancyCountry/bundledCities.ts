/** B803: словарь GeoNames из сборки (0,75 МБ); только обслуживание и тесты — веб читает таблицу. */
import type { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import type { CityDictionary } from './cityCountry';
import { CITY_COUNTRY_GZIP_BASE64 } from './cityCountryData';
import { CITY_TABLE_SQL } from './sqliteCities';

interface Entry {
  readonly code?: string;
  readonly namesakes?: string;
}

function entries(): ReadonlyMap<string, Entry> {
  const result = new Map<string, Entry>();
  const text = gunzipSync(Buffer.from(CITY_COUNTRY_GZIP_BASE64.join(''), 'base64')).toString();
  for (const line of text.split('\n')) {
    const [key = '', ...names] = line.split('|');
    const entry: Entry = key.startsWith('~') ? { namesakes: key.slice(1) } : { code: key };
    for (const name of names) result.set(name, { ...result.get(name), ...entry });
  }
  return result;
}

export function bundledCities(): CityDictionary {
  const known = entries();
  return {
    code: (name) => known.get(name)?.code,
    namesakes: (name) => known.get(name)?.namesakes,
  };
}

/** Таблица для веб-процесса; тот же словарь второй раз не пишется. */
export function writeCityTable(database: DatabaseSync): number {
  database.exec(CITY_TABLE_SQL);
  const known = entries();
  const { count } = database.prepare('SELECT COUNT(*) AS count FROM city_countries').get() as {
    count: number;
  };
  if (count === known.size) return 0;
  const insert = database.prepare('INSERT INTO city_countries VALUES (?, ?, ?)');
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec('DELETE FROM city_countries');
    for (const [name, { code, namesakes }] of known)
      insert.run(name, code ?? null, namesakes ?? null);
    database.exec('COMMIT');
  } catch (error: unknown) {
    database.exec('ROLLBACK');
    throw error;
  }
  return known.size;
}
