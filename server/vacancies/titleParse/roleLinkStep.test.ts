import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { MIGRATION_35 } from '../../data/sqliteSchema';
import { ROLE_LINK_MODEL_TITLES, RoleLinkStep } from './roleLinkStep';

function databaseWith(titles: readonly [string, string][]) {
  const database = new DatabaseSync(':memory:');
  database.exec(MIGRATION_35);
  const parse = database.prepare(
    `INSERT INTO title_parse (title_key, sample_title, functions, level_rank, role_label, parsed_by, model, taxonomy_version, priority, parsed_at)
     VALUES (?, ?, ?, 2, NULL, 'model', NULL, 3, 0, 0)`,
  );
  const semantic = database.prepare(
    `INSERT INTO vacancy_semantic (id, function_code, level_rank, title_key, published_ms, is_remote) VALUES (?, 'it-ops', 2, ?, 1, 0)`,
  );
  for (const [key, functions] of titles) {
    parse.run(key, key, functions);
    semantic.run(`id-${key}`, key);
  }
  return database;
}

const roleOf = (database: DatabaseSync, key: string) =>
  database.prepare('SELECT role_id, source, raw_role FROM vacancy_role WHERE title_key = ?').get(key);

const answer = (items: unknown) => ({
  complete: vi.fn(async () => ({ content: JSON.stringify({ items }), model: 'gemini-test' })),
});

describe('связь названия с ролью (малая партия)', () => {
  it('правила пишут роль без модели, модель получает только неизвестные', async () => {
    const database = databaseWith([['it-директор', '["it-ops"]'], ['странная служба ит', '["it-ops"]']]);
    const client = answer([{ titleKey: 'странная служба ит', roleId: 'it-ops.head' }]);
    const report = await new RoleLinkStep(database, client as never).run();

    expect(report).toMatchObject({ rules: 1, linked: 1, failed: false });
    expect(roleOf(database, 'it-директор')).toMatchObject({ role_id: 'it-ops.cio', source: 'rules' });
    expect(roleOf(database, 'странная служба ит')).toMatchObject({ role_id: 'it-ops.head', source: 'model' });
    expect(JSON.stringify(client.complete.mock.calls[0])).not.toContain('it-директор');
  });

  it('ответ вне закрытого списка не становится ролью, но сохраняется для разбора', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]'], ['другая служба ит', '["it-ops"]']]);
    const client = answer([
      { titleKey: 'странная служба ит', roleId: 'придуманная.роль' },
      { titleKey: 'другая служба ит', roleId: null },
    ]);
    const report = await new RoleLinkStep(database, client as never).run();

    expect(report).toMatchObject({ outsideList: 1, noRole: 1, linked: 0 });
    expect(roleOf(database, 'странная служба ит')).toMatchObject({ role_id: null, raw_role: 'придуманная.роль' });
  });

  it('список ролей только из функций названий пачки', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]']]);
    const client = answer([{ titleKey: 'странная служба ит', roleId: null }]);
    await new RoleLinkStep(database, client as never).run();
    const input = JSON.parse((client.complete.mock.calls[0] as never as [{ input: string }])[0].input) as {
      roles: { id: string }[];
    };
    expect(input.roles.length).toBeGreaterThan(0);
    expect(input.roles.every((role) => role.id.startsWith('it-ops.'))).toBe(true);
  });

  it('у потолка партии модель больше не зовётся', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]']]);
    const insert = database.prepare(
      `INSERT INTO vacancy_role (title_key, role_id, source, model, raw_role, created_ms) VALUES (?, NULL, 'model', 'm', NULL, 0)`,
    );
    for (let index = 0; index < ROLE_LINK_MODEL_TITLES; index += 1) insert.run(`k${index}`);
    const client = answer([]);
    await new RoleLinkStep(database, client as never).run();
    expect(client.complete).not.toHaveBeenCalled();
  });

  it('сбой канала не пишет строк, и название спросят снова', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]']]);
    const client = { complete: vi.fn(async () => Promise.reject(new Error('channel down'))) };
    const log = { warn: vi.fn() };
    const report = await new RoleLinkStep(database, client as never, log).run();
    expect(report.failed).toBe(true);
    expect(roleOf(database, 'странная служба ит')).toBeUndefined();
    expect(log.warn).toHaveBeenCalledOnce();
  });
});
