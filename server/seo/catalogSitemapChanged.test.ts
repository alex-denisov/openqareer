import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CatalogSitemapReader } from './catalogSitemapChanged';
import { CATALOG_SITEMAPS_TABLE_SQL, writeCatalogSitemaps } from './catalogSitemapJob';

const file = (name: string, xml: string) => ({ name, xml, urlCount: 1, lastmod: '2026-11-23' });

/** Все SQL, подготовленные на соединении: какие таблицы читал читатель. */
function spied(database: DatabaseSync): string[] {
  const seen: string[] = [];
  const prepare = database.prepare.bind(database);
  database.prepare = ((sql: string) => {
    seen.push(sql);
    return prepare(sql);
  }) as typeof database.prepare;
  return seen;
}

describe('B776: веб-процесс перечитывает карты сайта, только когда обслуживание записало новые', () => {
  it('та же сборка — null без чтения файлов; новая — файлы; таблицы нет — null', () => {
    const database = new DatabaseSync(':memory:');
    const reader = new CatalogSitemapReader();
    expect(reader.readIfChanged(database)).toBeNull();
    writeCatalogSitemaps(database, [file('jobs-1.xml', '<a/>')], new Date('2026-11-23T08:00:00Z'));
    expect(reader.readIfChanged(database)?.map((f) => f.name)).toEqual(['jobs-1.xml']);
    expect(reader.readIfChanged(database)).toBeNull();
    writeCatalogSitemaps(database, [file('jobs-1.xml', '<b/>')], new Date('2026-11-23T08:30:00Z'));
    expect(reader.readIfChanged(database)?.[0]?.xml).toBe('<b/>');
  });

  // Прод 23.11: подпись по строкам catalog_sitemaps шла 0,5 с — её столбцы лежат после 17 МБ xml.
  it('неизменная сборка проверяется по строке сборки, без чтения таблицы файлов', () => {
    const database = new DatabaseSync(':memory:');
    const reader = new CatalogSitemapReader();
    writeCatalogSitemaps(database, [file('jobs-1.xml', '<a/>')], new Date('2026-11-23T08:00:00Z'));
    reader.readIfChanged(database);
    const seen = spied(database);
    expect(reader.readIfChanged(database)).toBeNull();
    expect(seen.some((sql) => /FROM catalog_sitemaps\b/.test(sql))).toBe(false);
  });

  it('база до этой правки (строки сборки нет): подпись по таблице файлов, как раньше', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(CATALOG_SITEMAPS_TABLE_SQL);
    database
      .prepare(
        "INSERT INTO catalog_sitemaps (name, position, xml, url_count, lastmod, updated_at) VALUES ('jobs-1.xml', 0, '<a/>', 1, NULL, '2026-11-23T08:00:00Z')",
      )
      .run();
    const reader = new CatalogSitemapReader();
    expect(reader.readIfChanged(database)?.[0]?.xml).toBe('<a/>');
    expect(reader.readIfChanged(database)).toBeNull();
  });
});
