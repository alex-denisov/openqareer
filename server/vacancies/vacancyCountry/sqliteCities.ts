/** B803: города и страны работодателей, записанные обслуживанием; таблиц ещё нет — ответа нет. */
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import type { CityDictionary } from './cityCountry';

export const CITY_TABLE_SQL = `CREATE TABLE IF NOT EXISTS city_countries (
  name TEXT PRIMARY KEY, code TEXT, namesakes TEXT
) STRICT, WITHOUT ROWID`;
export const EMPLOYER_TABLE_SQL = `CREATE TABLE IF NOT EXISTS employer_countries (
  employer TEXT PRIMARY KEY, country TEXT NOT NULL
) STRICT, WITHOUT ROWID`;

function lazyStatement(database: DatabaseSync, sql: string): () => StatementSync | undefined {
  let statement: StatementSync | undefined;
  return () => {
    try {
      statement ??= database.prepare(sql);
    } catch (error: unknown) {
      if (!(error instanceof Error && error.message.includes('no such table'))) throw error;
    }
    return statement;
  };
}

export function sqliteCities(database: DatabaseSync): CityDictionary {
  const statement = lazyStatement(
    database,
    'SELECT code, namesakes FROM city_countries WHERE name = ?',
  );
  const read = (name: string) =>
    statement()?.get(name) as { code: string | null; namesakes: string | null } | undefined;
  return {
    code: (name) => read(name)?.code ?? undefined,
    namesakes: (name) => read(name)?.namesakes ?? undefined,
  };
}

export function sqliteEmployerCountry(
  database: DatabaseSync,
): (employer: string) => string | undefined {
  const statement = lazyStatement(
    database,
    'SELECT country FROM employer_countries WHERE employer = ?',
  );
  return (employer) => (statement()?.get(employer) as { country: string } | undefined)?.country;
}
