import { describe, expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { MIGRATION_30, MIGRATION_31 } from '../data/sqliteSchema';
import { SqliteHhCrawlSettings } from './hhCrawlSettings';
import { DEFAULT_SELECTED_ROLE_IDS } from './hhRoleCatalog';

function store(): SqliteHhCrawlSettings {
  const database = new DatabaseSync(':memory:');
  database.exec(MIGRATION_30);
  database.exec(MIGRATION_31);
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

  it('смена фильтра снимает отметку — новые роли собираются сразу', () => {
    const s = store();
    s.markFullSweep('2026-09-13T12:00:00.000Z');
    expect(s.read().lastFullSweepAt).toBe('2026-09-13T12:00:00.000Z');

    s.saveRoles(['96', '124'], 30);

    // Иначе роль, добавленную владельцем, обход не увидел бы до суток.
    expect(s.read().lastFullSweepAt).toBeUndefined();
  });

  it('снятие отметки вручную тоже возможно — глубокий проход по требованию', () => {
    const s = store();
    s.markFullSweep('2026-09-13T12:00:00.000Z');

    s.requestFullSweep();

    expect(s.read().lastFullSweepAt).toBeUndefined();
    expect(s.read().roleIds.length).toBe(25);
  });

  it('отметка прохода не стирает выбор ролей', () => {
    const s = store();
    s.saveRoles(['96'], 7);
    s.markFullSweep('2026-09-13T12:00:00.000Z');

    expect(s.read()).toMatchObject({ roleIds: ['96'], searchPeriodDays: 7 });
  });
});

describe('SqliteHhCrawlSettings: курсор глубокого прохода (B219)', () => {
  const plan = {
    queries: [{ roleId: '96', totalResults: 100, pages: 2, truncated: false }],
    expectedResults: 100,
    expectedPages: 2,
    truncatedQueries: 0,
  };

  const progressStore = store;

  it('без прохода курсора нет', () => {
    expect(progressStore().readProgress()).toBeUndefined();
  });

  it('курсор переживает перечитывание вместе с планом', () => {
    const s = progressStore();
    s.saveProgress({
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan,
      startedAt: '2026-09-15T06:00:00.000Z',
      roleIndex: 2,
      queryIndex: 0,
      page: 1,
      pagesRead: 1,
      errors: 2,
    });

    expect(s.readProgress()).toEqual({
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan,
      startedAt: '2026-09-15T06:00:00.000Z',
      roleIndex: 2,
      queryIndex: 0,
      page: 1,
      pagesRead: 1,
      errors: 2,
    });
  });

  it('повторное сохранение двигает курсор, а не плодит строки', () => {
    const s = progressStore();
    s.saveProgress({
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan,
      startedAt: '2026-09-15T06:00:00.000Z',
      roleIndex: 0,
      queryIndex: 0,
      page: 0,
      pagesRead: 0,
      errors: 0,
    });
    s.saveProgress({
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan,
      startedAt: '2026-09-15T06:00:00.000Z',
      roleIndex: 0,
      queryIndex: 3,
      page: 7,
      pagesRead: 40,
      errors: 1,
    });

    expect(s.readProgress()).toMatchObject({ queryIndex: 3, page: 7, pagesRead: 40, errors: 1 });
  });

  it('saveCursor двигает курсор, не переписывая план', () => {
    const s = progressStore();
    s.saveProgress({
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan,
      startedAt: '2026-09-15T06:00:00.000Z',
      roleIndex: 0,
      queryIndex: 0,
      page: 0,
      pagesRead: 0,
      errors: 0,
    });
    s.saveCursor({ queryIndex: 2, page: 5 }, 30, 3);

    expect(s.readProgress()).toMatchObject({
      plan,
      queryIndex: 2,
      page: 5,
      pagesRead: 30,
      errors: 3,
    });
  });

  it('кэш плана хранит набор ролей и время замера', () => {
    const s = progressStore();
    expect(s.readPlanCache()).toBeUndefined();

    s.savePlanCache({
      roleIds: ['96', '124'],
      searchPeriodDays: 30,
      plan,
      plannedAt: '2026-09-15T06:00:00.000Z',
    });

    expect(s.readPlanCache()).toEqual({
      roleIds: ['96', '124'],
      searchPeriodDays: 30,
      plan,
      plannedAt: '2026-09-15T06:00:00.000Z',
    });
  });

  it('clearProgress снимает курсор', () => {
    const s = progressStore();
    s.saveProgress({
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan,
      startedAt: '2026-09-15T06:00:00.000Z',
      roleIndex: 0,
      queryIndex: 0,
      page: 0,
      pagesRead: 0,
      errors: 0,
    });
    s.clearProgress();

    expect(s.readProgress()).toBeUndefined();
  });

  it('смена набора ролей сбрасывает курсор: план строился по старому набору', () => {
    const s = progressStore();
    s.saveProgress({
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan,
      startedAt: '2026-09-15T06:00:00.000Z',
      roleIndex: 0,
      queryIndex: 0,
      page: 0,
      pagesRead: 0,
      errors: 0,
    });
    s.saveRoles(['96', '124'], 30);

    expect(s.readProgress()).toBeUndefined();
  });

  it('запрос глубокого прохода сбрасывает курсор', () => {
    const s = progressStore();
    s.saveProgress({
      phase: 'reading',
      roleIds: ['96'],
      searchPeriodDays: 30,
      plan,
      startedAt: '2026-09-15T06:00:00.000Z',
      roleIndex: 0,
      queryIndex: 0,
      page: 0,
      pagesRead: 0,
      errors: 0,
    });
    s.requestFullSweep();

    expect(s.readProgress()).toBeUndefined();
  });

  it('нечитаемый план в базе — это отсутствие курсора, а не падение', () => {
    const database = new DatabaseSync(':memory:');
    database.exec(MIGRATION_30);
    database.exec(MIGRATION_31);
    database
      .prepare(
        `INSERT INTO hh_crawl_progress (id, phase, role_ids, search_period_days, plan_json, started_at, role_index, query_index, page, pages_read, errors, updated_at)
         VALUES (1, 'reading', '["96"]', 30, 'не json', '2026-09-15T06:00:00.000Z', 0, 0, 0, 0, 0, '2026-09-15T06:00:00.000Z')`,
      )
      .run();

    expect(new SqliteHhCrawlSettings(database).readProgress()).toBeUndefined();
  });
});
