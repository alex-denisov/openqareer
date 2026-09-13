import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATION_30 } from '../data/sqliteSchema';
import { SqliteHhCrawlSettings } from './hhCrawlSettings';
import { DEFAULT_SELECTED_ROLE_IDS } from './hhRoleCatalog';

function store(): SqliteHhCrawlSettings {
  const database = new DatabaseSync(':memory:');
  database.exec(MIGRATION_30);
  return new SqliteHhCrawlSettings(database);
}

describe('SqliteHhCrawlSettings', () => {
  it('без выбора владельца берутся роли ИТ-категории', () => {
    const settings = store().read();

    expect(settings.roleIds).toEqual([...DEFAULT_SELECTED_ROLE_IDS]);
    expect(settings.roleIds.length).toBe(25);
    expect(settings.searchPeriodDays).toBe(30);
    expect(settings.lastFullSweepAt).toBeUndefined();
  });

  it('выбор владельца переживает перечитывание', () => {
    const s = store();
    s.saveRoles(['96', '124'], 14);

    expect(s.read()).toMatchObject({ roleIds: ['96', '124'], searchPeriodDays: 14 });
  });

  it('несуществующая роль в набор не попадает', () => {
    const s = store();
    s.saveRoles(['96', 'нет-такой', '124'], 30);

    expect(s.read().roleIds).toEqual(['96', '124']);
  });

  it('повтор роли не задваивается', () => {
    const s = store();
    s.saveRoles(['96', '96', '124'], 30);

    expect(s.read().roleIds).toEqual(['96', '124']);
  });

  it('пустой набор ролей не сохраняется — обход без ролей бессмыслен', () => {
    const s = store();
    s.saveRoles(['96'], 30);

    expect(() => s.saveRoles([], 30)).toThrow();
    expect(s.read().roleIds).toEqual(['96']);
  });

  it('период ограничен разумными пределами площадки', () => {
    const s = store();

    expect(() => s.saveRoles(['96'], 0)).toThrow();
    expect(() => s.saveRoles(['96'], 400)).toThrow();
  });

  it('отметка полного прохода сохраняется и читается', () => {
    const s = store();
    s.markFullSweep('2026-09-13T12:00:00.000Z');

    expect(s.read().lastFullSweepAt).toBe('2026-09-13T12:00:00.000Z');
  });

  it('отметка прохода не стирает выбор ролей', () => {
    const s = store();
    s.saveRoles(['96'], 7);
    s.markFullSweep('2026-09-13T12:00:00.000Z');

    expect(s.read()).toMatchObject({ roleIds: ['96'], searchPeriodDays: 7 });
  });
});
