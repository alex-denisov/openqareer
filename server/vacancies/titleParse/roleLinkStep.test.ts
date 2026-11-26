import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { MIGRATION_35 } from '../../data/sqliteSchema';
import { ROLE_LINK_MODEL_TITLES, ROLE_LINK_SPEND_CAP_USD, RoleLinkStep } from './roleLinkStep';

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
  database
    .prepare('SELECT role_id, source, raw_role FROM vacancy_role WHERE title_key = ?')
    .get(key);

const answer = (items: unknown) => ({
  complete: vi.fn(async () => ({
    content: JSON.stringify({ items }),
    model: 'gemini-test',
    provider: 'gemini',
  })),
});

describe('связь названия с ролью (малая партия)', () => {
  it('правила пишут роль без модели, модель получает только неизвестные', async () => {
    const database = databaseWith([
      ['it-директор', '["it-ops"]'],
      ['странная служба ит', '["it-ops"]'],
    ]);
    const client = answer([{ titleKey: 'странная служба ит', roleId: 'it-ops.head' }]);
    const report = await new RoleLinkStep(database, client as never).run();

    expect(report).toMatchObject({ rules: 1, linked: 1, failed: false });
    expect(roleOf(database, 'it-директор')).toMatchObject({
      role_id: 'it-ops.cio',
      source: 'rules',
    });
    expect(roleOf(database, 'странная служба ит')).toMatchObject({
      role_id: 'it-ops.head',
      source: 'model',
    });
    expect(JSON.stringify(client.complete.mock.calls[0])).not.toContain('it-директор');
  });

  it('ответ вне закрытого списка не становится ролью, но сохраняется для разбора', async () => {
    const database = databaseWith([
      ['странная служба ит', '["it-ops"]'],
      ['другая служба ит', '["it-ops"]'],
    ]);
    const client = answer([
      { titleKey: 'странная служба ит', roleId: 'придуманная.роль' },
      { titleKey: 'другая служба ит', roleId: null },
    ]);
    const report = await new RoleLinkStep(database, client as never).run();

    expect(report).toMatchObject({ outsideList: 1, noRole: 1, linked: 0 });
    expect(roleOf(database, 'странная служба ит')).toMatchObject({
      role_id: null,
      raw_role: 'придуманная.роль',
    });
  });

  it('список ролей только из функций названий пачки', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]']]);
    const client = answer([{ titleKey: 'странная служба ит', roleId: null }]);
    await new RoleLinkStep(database, client as never).run();
    const input = JSON.parse(
      (client.complete.mock.calls[0] as never as [{ input: string }])[0].input,
    ) as {
      roles: { id: string }[];
    };
    expect(input.roles.length).toBeGreaterThan(0);
    expect(input.roles.every((role) => role.id.startsWith('it-ops.'))).toBe(true);
  });

  it('у потолка партии модель больше не зовётся', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]']]);
    const insert = database.prepare(
      `INSERT INTO vacancy_role (title_key, role_id, source, model, raw_role, created_ms) VALUES (?, NULL, 'model', 'gemini-test', NULL, 0)`,
    );
    for (let index = 0; index < ROLE_LINK_MODEL_TITLES; index += 1) insert.run(`k${index}`);
    const client = answer([]);
    await new RoleLinkStep(database, client as never, undefined, Date.now, 'sample').run();
    expect(client.complete).not.toHaveBeenCalled();
  });

  it('идёт по общей цепочке Vertex → DeepSeek → GLM, а не только Vertex (12.11)', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]']]);
    const client = answer([{ titleKey: 'странная служба ит', roleId: null }]);
    await new RoleLinkStep(database, client as never).run();
    const request = (client.complete.mock.calls[0] as never as [Record<string, unknown>])[0];
    expect(request).not.toHaveProperty('onlyVertex');
    expect(request).not.toHaveProperty('withoutVertex');
  });

  it('«нет роли» от DeepSeek после 12.11 не спрашивается снова', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]']]);
    database
      .prepare(
        `INSERT INTO vacancy_role (title_key, role_id, source, model, raw_role, created_ms) VALUES (?, NULL, 'model', 'deepseek/deepseek-v4-flash', NULL, ?)`,
      )
      .run('странная служба ит', Date.parse('2026-11-12T12:00:00Z'));
    const client = answer([{ titleKey: 'странная служба ит', roleId: 'it-ops.head' }]);
    await new RoleLinkStep(database, client as never).run();
    expect(client.complete).not.toHaveBeenCalled();
  });

  it('отказ всей цепочки ставит паузу, а не повтор на следующем такте', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]']]);
    const client = {
      complete: vi.fn(async () => {
        throw new Error('Bulk channel unavailable');
      }),
    };
    let now = Date.parse('2026-11-12T12:00:00Z');
    const step = new RoleLinkStep(database, client as never, undefined, () => now);
    expect((await step.run()).failed).toBe(true);
    now += 60_000;
    await step.run();
    expect(client.complete).toHaveBeenCalledTimes(1);
  });

  it('«нет роли» от другой модели до 12.11 спрашивается заново', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]']]);
    database
      .prepare(
        `INSERT INTO vacancy_role (title_key, role_id, source, model, raw_role, created_ms) VALUES (?, NULL, 'model', 'deepseek/deepseek-v4-flash', NULL, 0)`,
      )
      .run('странная служба ит');
    const client = answer([{ titleKey: 'странная служба ит', roleId: 'it-ops.head' }]);
    await new RoleLinkStep(database, client as never).run();
    expect(roleOf(database, 'странная служба ит')).toMatchObject({
      role_id: 'it-ops.head',
      source: 'model',
    });
  });

  it('название без функции не идёт в модель, а старая связь снимается', async () => {
    const database = databaseWith([
      ['senior director', '["it-ops"]'],
      ['странная служба ит', '["it-ops"]'],
    ]);
    database
      .prepare(
        `INSERT INTO vacancy_role (title_key, role_id, source, model, raw_role, created_ms) VALUES ('head', 'audit-risk.compliance-lead', 'model', 'gemini-test', NULL, 0)`,
      )
      .run();
    const client = answer([{ titleKey: 'странная служба ит', roleId: null }]);
    const report = await new RoleLinkStep(database, client as never).run();
    expect(report.noFunction).toBe(1);
    expect(roleOf(database, 'senior director')).toMatchObject({
      role_id: null,
      source: 'no-function',
    });
    expect(roleOf(database, 'head')).toMatchObject({ role_id: null, source: 'no-function' });
    expect(JSON.stringify(client.complete.mock.calls[0])).not.toContain('senior director');
  });

  it('главный бухгалтер уходит из рядового и получает свою роль', async () => {
    const database = databaseWith([['главный бухгалтер', '["finance"]']]);
    database
      .prepare(
        `INSERT INTO vacancy_role (title_key, role_id, source, model, raw_role, created_ms) VALUES ('главный бухгалтер', 'finance.accountant.ic', 'model', 'gemini-test', NULL, 0)`,
      )
      .run();
    await new RoleLinkStep(database, answer([]) as never).run();
    expect(roleOf(database, 'главный бухгалтер')).toMatchObject({
      role_id: 'finance.chief-accountant.head',
      source: 'rules',
    });
  });

  it('на стадии прохода потолок задаёт расход, а не число названий', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]']]);
    database.exec(`CREATE TABLE bulk_llm_spend (task TEXT, cost REAL)`);
    const spend = database.prepare(
      `INSERT INTO bulk_llm_spend (task, cost) VALUES ('role-link', ?)`,
    );
    spend.run(ROLE_LINK_SPEND_CAP_USD - 1);
    const insert = database.prepare(
      `INSERT INTO vacancy_role (title_key, role_id, source, model, raw_role, created_ms) VALUES (?, NULL, 'model', 'gemini-test', NULL, 0)`,
    );
    for (let index = 0; index < ROLE_LINK_MODEL_TITLES; index += 1) insert.run(`k${index}`);
    const client = answer([{ titleKey: 'странная служба ит', roleId: null }]);
    const step = new RoleLinkStep(database, client as never, undefined, Date.now, 'pass');
    await step.run();
    expect(client.complete).toHaveBeenCalledOnce();

    spend.run(1);
    await step.run();
    expect(client.complete).toHaveBeenCalledOnce();
  });

  it('отказы подряд удваивают паузу до потолка и не тратят предел вызовов', async () => {
    const database = databaseWith([['странная служба ит', '["it-ops"]']]);
    const refuse = vi.fn(async () => Promise.reject(new Error('cooling')));
    let clock = 0;
    const step = new RoleLinkStep(
      database,
      { complete: refuse } as never,
      { warn: vi.fn() },
      () => clock,
    );
    const attemptsAt = (minutes: readonly number[]) =>
      minutes.reduce(async (done, minute) => {
        await done;
        clock = minute * 60_000;
        await step.run();
      }, Promise.resolve() as Promise<void>);

    await attemptsAt([0, 1, 2, 3, 5, 6, 9]);
    // 0, затем пауза 2 мин (2), 4 мин (6), 8 мин (следующая на 14).
    expect(refuse).toHaveBeenCalledTimes(3);

    await attemptsAt([14, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390]);
    expect(refuse).toHaveBeenCalledTimes(17);
  });

  it('после ответа следующая пачка не раньше чем через 2 минуты', async () => {
    const database = databaseWith([
      ['странная служба ит', '["it-ops"]'],
      ['другая служба ит', '["it-ops"]'],
    ]);
    const client = answer([{ titleKey: 'странная служба ит', roleId: null }]);
    let clock = 0;
    const step = new RoleLinkStep(database, client as never, undefined, () => clock);
    await step.run();
    clock = 60_000;
    await step.run();
    expect(client.complete).toHaveBeenCalledOnce();
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
