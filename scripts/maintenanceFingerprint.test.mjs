import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAINTENANCE_FILES, fingerprintOf, schemaSourcesOf, schemaSourcesUsedBy } from './maintenanceFingerprint.mjs';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const dirs = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function dist(files) {
  const dir = mkdtempSync(join(tmpdir(), 'oq-fingerprint-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

function maintenanceDist(release, body = 'run()') {
  return dist({
    'maintenance.mjs': `const release="${release}";${body}`,
    'site-render-worker.mjs': `const release="${release}";render()`,
    'freehire-pages-worker.mjs': 'pages()',
    'heavy-read-worker.mjs': 'reads()',
    'data/freehire/boards.tsv.gz': 'boards',
  });
}

const SCHEMA = [{ path: 'server/data/sqliteSchema.ts', text: 'CREATE TABLE a (id TEXT)' }];

describe('отпечаток обслуживания (B759)', () => {
  it('не зависит от SHA релиза: тот же код — тот же отпечаток', () => {
    const a = fingerprintOf(maintenanceDist(SHA_A), MAINTENANCE_FILES, SHA_A, SCHEMA);
    const b = fingerprintOf(maintenanceDist(SHA_B), MAINTENANCE_FILES, SHA_B, SCHEMA);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(b);
  });

  it('другой код обслуживания — другой отпечаток', () => {
    const a = fingerprintOf(maintenanceDist(SHA_A), MAINTENANCE_FILES, SHA_A, SCHEMA);
    const b = fingerprintOf(maintenanceDist(SHA_B, 'run2()'), MAINTENANCE_FILES, SHA_B, SCHEMA);
    expect(a).not.toBe(b);
  });

  it('другие данные рядом с бандлом — другой отпечаток', () => {
    const base = maintenanceDist(SHA_A);
    const a = fingerprintOf(base, MAINTENANCE_FILES, SHA_A, SCHEMA);
    writeFileSync(join(base, 'data/freehire/boards.tsv.gz'), 'boards-2');
    expect(fingerprintOf(base, MAINTENANCE_FILES, SHA_A, SCHEMA)).not.toBe(a);
  });

  it('смена миграций веб-процесса меняет отпечаток, даже если бандл обслуживания тот же', () => {
    const base = maintenanceDist(SHA_A);
    const a = fingerprintOf(base, MAINTENANCE_FILES, SHA_A, SCHEMA);
    const migrated = [
      ...SCHEMA,
      { path: 'server/data/diaryCoachMigration.ts', text: 'ALTER TABLE a ADD COLUMN b TEXT' },
    ];
    expect(fingerprintOf(base, MAINTENANCE_FILES, SHA_A, migrated)).not.toBe(a);
    const edited = [{ path: SCHEMA[0].path, text: 'CREATE TABLE a (id TEXT, b TEXT)' }];
    expect(fingerprintOf(base, MAINTENANCE_FILES, SHA_A, edited)).not.toBe(a);
  });

  it('файла бандла нет — сборка падает, а не пишет отпечаток без него', () => {
    const base = dist({ 'maintenance.mjs': 'x' });
    expect(() =>
      fingerprintOf(base, ['maintenance.mjs', 'heavy-read-worker.mjs'], SHA_A, SCHEMA),
    ).toThrow(/heavy-read-worker\.mjs/);
  });
});

describe('источники схемы из metafile сборки веб-процесса (B759)', () => {
  it('берёт только модули сервера со словами DDL, по порядку пути', () => {
    const texts = {
      'server/data/sqliteSchema.ts':
        'export const MIGRATION_1 = `CREATE TABLE IF NOT EXISTS x (id)`',
      'server/routes/health.ts': 'export const ok = 1',
      'server/data/diaryCoachMigration.ts': 'ALTER TABLE diary ADD COLUMN stage TEXT',
      'node_modules/zod/index.js': 'CREATE TABLE in a comment',
      'server/vacancies/indexes.ts': 'CREATE INDEX IF NOT EXISTS i ON x (id)',
    };
    const metafile = { inputs: Object.fromEntries(Object.keys(texts).map((key) => [key, {}])) };
    const sources = schemaSourcesOf(metafile, (path) => texts[path]);
    expect(sources.map((source) => source.path)).toEqual([
      'server/data/diaryCoachMigration.ts',
      'server/data/sqliteSchema.ts',
      'server/vacancies/indexes.ts',
    ]);
  });

  it('правка кода рядом с DDL не меняет источник схемы, правка самого DDL — меняет', () => {
    const before = {
      'server/vacancies/sqliteVacancyPoolStore.ts':
        'const SCHEMA = `CREATE TABLE IF NOT EXISTS pool (id TEXT);\nCREATE INDEX IF NOT EXISTS pool_id ON pool (id)`;\nexport function read() { return 1; }',
    };
    const metafile = { inputs: { 'server/vacancies/sqliteVacancyPoolStore.ts': {} } };
    const of = (texts) => schemaSourcesOf(metafile, (path) => texts[path]);
    const codeOnly = {
      'server/vacancies/sqliteVacancyPoolStore.ts': before[
        'server/vacancies/sqliteVacancyPoolStore.ts'
      ].replace('return 1', 'return 2'),
    };
    expect(of(codeOnly)).toEqual(of(before));
    const ddl = {
      'server/vacancies/sqliteVacancyPoolStore.ts': before[
        'server/vacancies/sqliteVacancyPoolStore.ts'
      ].replace('id TEXT)', 'id TEXT, at INTEGER)'),
    };
    expect(of(ddl)).not.toEqual(of(before));
  });

  describe('перезапуск не теряется, когда схема меняется', () => {
    const FILE = 'server/data/someStore.ts';
    const metafile = { inputs: { [FILE]: {} } };
    const BASE =
      'const SCHEMA = `CREATE TABLE IF NOT EXISTS t (id TEXT)`;\nexport function read() { return 1; }';
    const sources = (text) => schemaSourcesOf(metafile, () => text);
    const changes = (next) => expect(sources(next)).not.toEqual(sources(BASE));

    it('добавлен CREATE INDEX', () =>
      changes(BASE.replace('`;', ';\nCREATE INDEX IF NOT EXISTS t_id ON t (id)`;')));
    it('добавлен CREATE TRIGGER', () =>
      changes(
        BASE.replace('`;', ';\nCREATE TRIGGER t_ai AFTER INSERT ON t BEGIN SELECT 1; END`;'),
      ));
    it('добавлен ALTER TABLE … ADD COLUMN', () =>
      changes(`${BASE}\ndb.exec('ALTER TABLE t ADD COLUMN at INTEGER');`));
    it('добавлен DROP', () => changes(`${BASE}\ndb.exec('DROP INDEX IF EXISTS t_old');`));
    it('файл без DDL получил схему', () => {
      expect(sources('export const ok = 1')).toEqual([]);
      expect(sources(BASE)).toHaveLength(1);
    });

    it('DDL из шаблонной строки: новая колонка в списке рядом — другой источник схемы', () => {
      const templated = (columns) =>
        `const COLUMNS = ${JSON.stringify(columns)};\nfor (const c of COLUMNS) db.exec(\`ALTER TABLE t ADD COLUMN \${c}\`);`;
      expect(sources(templated(['a TEXT', 'b TEXT']))).not.toEqual(sources(templated(['a TEXT'])));
    });

    it('DDL из шаблонной строки: новое имя таблицы в константе — другой источник схемы', () => {
      const named = (table) =>
        `const TABLE = '${table}';\nconst SQL = \`CREATE TABLE IF NOT EXISTS \${TABLE} (id TEXT)\`;`;
      expect(sources(named('t2'))).not.toEqual(sources(named('t1')));
    });
  });
});

describe('таблицы только веб-процесса (B759, выкат af80b90e2)', () => {
  const bundle = 'db.prepare("SELECT 1 FROM vacancy_pool")';
  const source = (text) => ({ path: 'server/data/x.ts', text });

  it('новая таблица, которой нет в бандле, в отпечаток не входит', () => {
    const own = source('CREATE TABLE IF NOT EXISTS manual_apply (id TEXT)\nCREATE INDEX IF NOT EXISTS ma_i ON manual_apply(id)');
    expect(schemaSourcesUsedBy(bundle, [own])).toEqual([]);
  });

  it('таблица, индекс и ALTER из бандла остаются, чужие из того же файла — нет', () => {
    const kept = 'CREATE UNIQUE INDEX i ON vacancy_pool(id)\nALTER TABLE "vacancy_pool" ADD COLUMN b TEXT\nCREATE TABLE vacancy_pool (id)';
    const [used] = schemaSourcesUsedBy(bundle, [source(`${kept}\nCREATE TABLE manual_apply (id)`)]);
    expect(used.text).toBe(kept);
  });

  it('имя-часть другого имени — не та же таблица', () => {
    expect(schemaSourcesUsedBy(bundle, [source('CREATE TABLE pool (id)')])).toEqual([]);
  });

  it('цель не ясна (триггер, DROP INDEX, файл с подстановкой) — входит', () => {
    const unclear = [
      source('CREATE TRIGGER t AFTER INSERT ON manual_apply BEGIN SELECT 1'),
      source('DROP INDEX some_i'),
      source('const t = "x"; db.exec(`ALTER TABLE ${t} ADD COLUMN y`)'),
    ];
    expect(schemaSourcesUsedBy(bundle, unclear)).toEqual(unclear);
  });
});
