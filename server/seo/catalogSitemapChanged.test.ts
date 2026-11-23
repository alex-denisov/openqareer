import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { CatalogSitemapReader } from './catalogSitemapChanged';
import { writeCatalogSitemaps } from './catalogSitemapJob';

const file = (name: string, xml: string) => ({ name, xml, urlCount: 1, lastmod: '2026-11-23' });

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
});
