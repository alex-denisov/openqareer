import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SqliteRoleNamingCache } from './sqliteRoleNamingCache';

/**
 * B191 / INC-035: названные роли обязаны пережить рестарт, и лежать они обязаны
 * зашифрованными — это производная от фактов кандидата.
 */
describe('SqliteRoleNamingCache', () => {
  const roles = [{ title: 'Продуктовый аналитик', reason: 'вёл метрики', evidenceRefs: ['memory:1'] }];

  function cache() {
    return new SqliteRoleNamingCache({
      databasePath: ':memory:',
      encryptionKey: randomBytes(32),
    });
  }

  it('отдаёт названное обратно вместе со ступенью', () => {
    const store = cache();
    store.write('key-1', { at: 1_700_000_000_000, roles, stage: 'gemini:gemini-3.6-flash' });

    expect(store.read('key-1')).toEqual({
      at: 1_700_000_000_000,
      roles,
      stage: 'gemini:gemini-3.6-flash',
    });
  });

  it('ничего не знает о ключе, которого не писали', () => {
    expect(cache().read('нет такого')).toBeUndefined();
  });

  it('не хранит названия ролей открытым текстом', () => {
    const store = cache();
    store.write('key-1', { at: 1_700_000_000_000, roles });

    const row = (
      store as unknown as {
        database: { prepare(sql: string): { get(key: string): { roles_cipher: string } } };
      }
    ).database
      .prepare('SELECT roles_cipher FROM role_naming_cache WHERE cache_key = ?')
      .get('key-1');

    expect(row.roles_cipher).not.toContain('Продуктовый аналитик');
  });

  it('заменяет прежнюю запись того же ключа', () => {
    const store = cache();
    store.write('key-1', { at: 1, roles });
    store.write('key-1', { at: 2, roles: [{ ...roles[0], title: 'Аналитик данных' }] });

    expect(store.read('key-1')?.roles[0].title).toBe('Аналитик данных');
  });
});
