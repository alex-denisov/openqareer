import { DatabaseSync } from 'node:sqlite';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import type { NamedRole } from '../../shared/roleProposals';
import type { RoleNamingCacheEntry, RoleNamingCacheStore } from '../providers/roleNamer';
import { MIGRATION_27 } from './sqliteSchema';
import { SealedText } from './sealedText';

/**
 * Названные роли между рестартами.
 *
 * Кэш называния жил в памяти процесса: каждый деплой стирал его, и первый вход
 * снова звал модель. Бесплатная квота Gemini этого не выдерживала — `429`, и
 * ответ кандидату стоил до 116 секунд вместо 12 (INC-035).
 *
 * Ключ — хэш «язык + факты», формулировок о человеке в нём нет. Сами названия
 * ролей выведены из фактов кандидата, поэтому лежат зашифрованными.
 */
export class SqliteRoleNamingCache implements RoleNamingCacheStore {
  private readonly database: DatabaseSync;
  private readonly sealedText: SealedText;

  constructor(options: { databasePath: string; encryptionKey: Buffer }) {
    if (options.databasePath !== ':memory:') {
      mkdirSync(dirname(options.databasePath), { recursive: true });
    }
    this.database = new DatabaseSync(options.databasePath);
    this.database.exec('PRAGMA journal_mode = WAL;');
    this.database.exec('PRAGMA foreign_keys = ON;');
    this.database.exec(MIGRATION_27);
    this.sealedText = new SealedText(options.encryptionKey);
  }

  read(key: string): RoleNamingCacheEntry | undefined {
    const row = this.database
      .prepare('SELECT named_at, roles_cipher FROM role_naming_cache WHERE cache_key = ?')
      .get(key) as { named_at: string; roles_cipher: string } | undefined;
    if (!row) return undefined;

    const at = Date.parse(row.named_at);
    if (Number.isNaN(at)) return undefined;
    try {
      const payload = JSON.parse(this.sealedText.open(row.roles_cipher, key)) as {
        roles: NamedRole[];
        stage?: string;
      };
      if (!Array.isArray(payload.roles) || payload.roles.length === 0) return undefined;
      return { at, roles: payload.roles, ...(payload.stage ? { stage: payload.stage } : {}) };
    } catch {
      // Строку, которую не удалось прочитать обратно, продукт не выдаёт за
      // названные роли — он спрашивает модель заново.
      return undefined;
    }
  }

  write(key: string, entry: RoleNamingCacheEntry): void {
    const payload = JSON.stringify({
      roles: entry.roles,
      ...(entry.stage ? { stage: entry.stage } : {}),
    });
    this.database
      .prepare(
        `INSERT INTO role_naming_cache (cache_key, named_at, roles_cipher)
         VALUES (?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           named_at = excluded.named_at,
           roles_cipher = excluded.roles_cipher`,
      )
      .run(key, new Date(entry.at).toISOString(), this.sealedText.seal(payload, key));
  }
}
