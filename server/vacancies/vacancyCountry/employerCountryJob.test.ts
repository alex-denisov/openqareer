import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { writeCityTable } from './bundledCities';
import { createCities } from './cityCountry';
import { computeEmployerCountries, writeEmployerCountries } from './employerCountryJob';
import { sqliteCities, sqliteEmployerCountry } from './sqliteCities';

describe('employer countries', () => {
  it('writes the dominant country of an employer', async () => {
    const database = new DatabaseSync(':memory:');
    expect(sqliteEmployerCountry(database)('acme')).toBeUndefined();
    database.exec('CREATE TABLE vacancy_cluster_input (id TEXT PRIMARY KEY, cluster_json TEXT)');
    const insert = database.prepare('INSERT INTO vacancy_cluster_input VALUES (?, ?)');
    ['Berlin', 'München', 'Hamburg, Germany', 'Remote'].forEach((location, index) =>
      insert.run(`${index}`, JSON.stringify({ company: 'Acme  GmbH', location })),
    );
    insert.run('x', JSON.stringify({ company: 'Small', location: 'Berlin' }));
    const countries = await computeEmployerCountries(database, {
      sliceRows: 2,
      every: 1,
      pause: async () => undefined,
    });
    writeEmployerCountries(database, countries);
    expect(sqliteEmployerCountry(database)('acme gmbh')).toBe('DE');
    expect(sqliteEmployerCountry(database)('small')).toBeUndefined();
  });

  it('writes the city table once and the web reads it without the bundled dictionary', () => {
    const database = new DatabaseSync(':memory:');
    const cities = createCities(sqliteCities(database));
    expect(cities.country('Friedrichshafen')).toBeUndefined();
    expect(writeCityTable(database)).toBeGreaterThan(10_000);
    expect(writeCityTable(database)).toBe(0);
    expect(cities.country('Friedrichshafen')).toBe('DE');
    expect(cities.countries('Cambridge')).toContain('US');
  });
});
