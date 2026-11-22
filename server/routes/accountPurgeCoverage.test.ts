import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { config as baseConfig, noSessions } from '../appTestHarness';
import type { SessionAuth } from '../auth/authService';
import type { AuthPrincipal } from '../auth/authTypes';
import { SqliteCandidateStore } from '../data/sqliteCandidateStore';
import { openSideTablesForPurgeTest } from './accountPurgeTestHarness';

/**
 * B739: удаление аккаунта не оставляет строк кандидата ни в одной таблице. Тест строит базу
 * приложения со всеми таблицами, кладёт по строке кандидата в каждую таблицу с владельцем
 * (`candidate_id`, `candidate_user_id`, `user_id`) и удаляет аккаунт настоящим маршрутом.
 */

const SERVER = join(import.meta.dirname, '..');
const OWNER_COLUMNS = ['candidate_id', 'candidate_user_id', 'user_id'] as const;
/** Таблицы, которые намеренно переживают удаление; ссылка на кандидата в них обнуляется. */
const RETAINED: Readonly<Record<string, string>> = {
  legal_consents:
    'запись об акцепте хранится 3 года с даты прекращения договора (B195); дата ставится при удалении',
  billing_invoices: 'счета нужны для бухгалтерии; user_id обнуляется (ON DELETE SET NULL)',
  billing_events: 'журнал оплат неизменяем по триггеру; user_id обнуляется (ON DELETE SET NULL)',
};
/** Объявлены в исходниках, но не таблицы кандидата в базе приложения. */
const NOT_IN_APP_DATABASE: Readonly<Record<string, string>> = {
  assessments_product_case_only: 'временная копия при перестройке схемы',
  vacancy_subscriptions_v14: 'временная копия при перестройке схемы',
  vacancy_subscriptions_v15: 'временная копия при перестройке схемы',
  vacancy_source_health_v15: 'временная копия при перестройке схемы',
};

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function declaredOwnerTables(): string[] {
  const files = readdirSync(SERVER, { recursive: true, encoding: 'utf8' }).filter(
    (file) => file.endsWith('.ts') && !file.includes('.test.'),
  );
  const tables = new Set<string>();
  for (const file of files) {
    for (const statement of readFileSync(join(SERVER, file), 'utf8').split(
      /(?=CREATE\s+(?:VIRTUAL\s+)?(?:TABLE|INDEX|UNIQUE|TRIGGER|VIEW))/i,
    )) {
      const table = /^CREATE\s+(?:VIRTUAL\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)/i.exec(
        statement,
      )?.[1];
      if (table && /\b(candidate_id|candidate_user_id|user_id)\b/i.test(statement))
        tables.add(table);
    }
  }
  return [...tables].sort();
}

interface Column {
  readonly name: string;
  readonly type: string;
  readonly notnull: number;
  readonly pk: number;
}
interface ForeignKey {
  readonly table: string;
  readonly from: string;
  readonly to: string | null;
}

function tableNames(database: DatabaseSync): string[] {
  return (
    database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{
      name: string;
    }>
  )
    .map(({ name }) => name)
    .filter(
      (name) =>
        !name.startsWith('sqlite_') && !/_fts_(config|content|data|docsize|idx)$/.test(name),
    )
    .sort();
}

const columnsOf = (database: DatabaseSync, table: string) =>
  database.prepare(`PRAGMA table_info("${table}")`).all() as unknown as Column[];
const keysOf = (database: DatabaseSync, table: string) =>
  database.prepare(`PRAGMA foreign_key_list("${table}")`).all() as unknown as ForeignKey[];

function ownerTables(database: DatabaseSync): string[] {
  return tableNames(database).filter(
    (table) =>
      table !== 'candidates' &&
      columnsOf(database, table).some((column) =>
        (OWNER_COLUMNS as readonly string[]).includes(column.name),
      ),
  );
}

/** Значения, которых не выводит разбор CHECK: сравнение двух столбцов. */
const OVERRIDES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  billing_pro_trials: { started_at: '2026-01-01', expires_at: '2026-02-01' },
};

const literal = (text: string): string | number =>
  text.startsWith("'") ? text.slice(1, -1) : Number(text);

/** Допустимое значение из `CHECK (column IN (...))`, `= ...` или `BETWEEN a AND b`. */
function checkedValue(sql: string, column: string): string | number | undefined {
  const check = `CHECK\\s*\\(\\s*${column}\\s+`;
  const list = new RegExp(`${check}IN\\s*\\(([^)]*)\\)`, 'i').exec(sql)?.[1]?.split(',')[0]?.trim();
  if (list) return literal(list);
  const equal = new RegExp(`${check}=\\s*('[^']*'|-?\\d+)`, 'i').exec(sql)?.[1];
  if (equal) return literal(equal);
  const between = new RegExp(`${check}BETWEEN\\s+(-?\\d+)`, 'i').exec(sql)?.[1];
  return between ? Number(between) : undefined;
}

interface SeedContext {
  readonly database: DatabaseSync;
  readonly candidateId: string;
  readonly userId: string;
  readonly tag: string;
  /** Номер набора: целые первичные ключи двух кандидатов не совпадают. */
  readonly serial: number;
  /** Значения уже вставленных строк: таблица → столбец → значение. */
  readonly rows: Map<string, Record<string, unknown>>;
}

function valueFor(
  context: SeedContext,
  table: string,
  sql: string,
  column: Column,
  keys: ForeignKey[],
): unknown {
  const override = OVERRIDES[table]?.[column.name];
  if (override !== undefined) return override;
  if (column.name === 'candidate_id') return context.candidateId;
  if (table === 'users' && column.name === 'id') return context.userId;
  if (column.name === 'candidate_user_id' || column.name === 'user_id') return context.userId;
  const key = keys.find((link) => link.from === column.name);
  if (key) {
    const parent = context.rows.get(key.table);
    return parent?.[key.to ?? 'id'] ?? null;
  }
  const checked = checkedValue(sql, column.name);
  if (checked !== undefined) return checked;
  if (/INT/i.test(column.type)) return column.pk ? context.serial : 1;
  if (/REAL/i.test(column.type)) return 1;
  if (/BLOB/i.test(column.type)) return Buffer.from('x');
  if (/json/i.test(column.name) || new RegExp(`json_valid\\(\\s*${column.name}`, 'i').test(sql))
    return '{}';
  if (column.notnull || column.pk)
    return /_at$|date|_on$|day|week_start/i.test(column.name)
      ? '2026-01-01'
      : `${context.tag}-${table}-${column.name}`;
  return null;
}

function ownerColumn(database: DatabaseSync, table: string): string {
  const names = columnsOf(database, table).map((column) => column.name);
  if (table === 'users') return 'id';
  return OWNER_COLUMNS.find((owner) => names.includes(owner)) ?? 'candidate_id';
}

/** Порядок вставки: родитель раньше ссылающейся на него таблицы. */
function insertOrder(database: DatabaseSync, tables: string[]): string[] {
  const pending = new Set(tables);
  const ordered: string[] = [];
  while (pending.size > 0) {
    const ready = [...pending].filter((table) =>
      keysOf(database, table).every((key) => !pending.has(key.table) || key.table === table),
    );
    if (ready.length === 0) throw new Error(`cycle: ${[...pending].join(', ')}`);
    for (const table of ready) {
      ordered.push(table);
      pending.delete(table);
    }
  }
  return ordered;
}

function seedEverything(context: SeedContext, tables: string[]): string[] {
  const failed: string[] = [];
  for (const table of insertOrder(context.database, tables)) {
    const sql = String(
      (
        context.database.prepare('SELECT sql FROM sqlite_master WHERE name = ?').get(table) as {
          sql: string;
        }
      ).sql,
    );
    const existing = context.database
      .prepare(`SELECT * FROM "${table}" WHERE ${ownerColumn(context.database, table)} = ? LIMIT 1`)
      .get(table === 'users' ? context.userId : context.candidateId) as
      Record<string, unknown> | undefined;
    if (existing) {
      // Строку уже создало хранилище (разговор появляется вместе с кандидатом).
      context.rows.set(table, existing);
      continue;
    }
    const keys = keysOf(context.database, table);
    const columns = columnsOf(context.database, table).filter((column) => column.name !== 'rowid');
    const row = Object.fromEntries(
      columns.map((column) => [column.name, valueFor(context, table, sql, column, keys)]),
    );
    const names = Object.keys(row);
    try {
      context.database
        .prepare(
          `INSERT INTO "${table}" (${names.map((name) => `"${name}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        )
        .run(...(Object.values(row) as never[]));
      context.rows.set(table, row);
    } catch (error) {
      failed.push(`${table}: ${(error as Error).message}`);
    }
  }
  return failed;
}

function leftRows(
  database: DatabaseSync,
  tables: string[],
  candidateId: string,
  userId: string,
): string[] {
  return tables.filter((table) => {
    const owners = columnsOf(database, table)
      .map((column) => column.name)
      .filter((name) => (OWNER_COLUMNS as readonly string[]).includes(name));
    return owners.some((owner) => {
      const value = owner === 'candidate_id' ? candidateId : userId;
      const row = database
        .prepare(`SELECT COUNT(*) AS total FROM "${table}" WHERE "${owner}" = ?`)
        .get(value) as { total: number };
      return Number(row.total) > 0;
    });
  });
}

async function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-purge-coverage-'));
  const config = {
    ...baseConfig,
    databasePath: join(directory, 'app.sqlite'),
    cabinetB640Usernames: ['own.test'],
  };
  const candidateStore = new SqliteCandidateStore({
    databasePath: config.databasePath,
    encryptionKey: config.dataEncryptionKey,
  });
  const own = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const other = candidateStore.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const principal: AuthPrincipal = {
    userId: 'user-own',
    username: 'own.test',
    email: null,
    displayName: null,
    role: 'candidate',
    isTest: true,
    candidate: own,
  };
  const authService: SessionAuth = {
    ...noSessions,
    authenticate: (token) => (token === 'own' ? principal : null),
  };
  const app = await buildApp({
    config,
    candidateStore,
    authService,
    coachProvider: {} as never,
    serveStatic: false,
  });
  await app.ready();
  openSideTablesForPurgeTest(config.databasePath, config.dataEncryptionKey, candidateStore);
  const database = new DatabaseSync(config.databasePath, { enableForeignKeyConstraints: true });
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => candidateStore.close(),
    () => app.close(),
    () => database.close(),
  );
  return { app, database, own: own.id, other: other.id };
}

describe('B739: удаление аккаунта стирает строки кандидата во всех таблицах', () => {
  it('в базе приложения есть каждая таблица с владельцем, объявленная в исходниках', async () => {
    const { database } = await setup();
    const present = new Set(tableNames(database));
    expect(
      declaredOwnerTables().filter(
        (table) => !present.has(table) && !(table in NOT_IN_APP_DATABASE),
      ),
    ).toEqual([]);
  });

  it('после удаления ни одна таблица не хранит строк кандидата, а чужие строки на месте', async () => {
    const { app, database, own, other } = await setup();
    const tables = ownerTables(database);
    const seed = (candidateId: string, userId: string, tag: string, serial: number) =>
      seedEverything({ database, candidateId, userId, tag, serial, rows: new Map() }, tables);
    expect(seed(own, 'user-own', 'own', 1)).toEqual([]);
    expect(seed(other, 'user-other', 'other', 2)).toEqual([]);

    const response = await app.inject({
      method: 'DELETE',
      url: '/api/v1/candidate/me',
      headers: { authorization: 'Bearer own', origin: 'http://localhost:3000' },
    });
    expect(response.statusCode).toBe(204);

    expect(
      leftRows(database, tables, own, 'user-own').filter((table) => !(table in RETAINED)),
    ).toEqual([]);
    const consent = database
      .prepare('SELECT contract_ended_at FROM legal_consents WHERE user_id = ?')
      .get('user-own') as {
      contract_ended_at: string | null;
    };
    expect(consent.contract_ended_at).not.toBeNull();
    const otherLeft = leftRows(database, tables, other, 'user-other');
    expect(tables.filter((table) => !otherLeft.includes(table))).toEqual([]);
  });
});
