// B777: ежедневная копия незаменимых данных. Схема переносится целиком, данные — всех таблиц,
// кроме собираемых заново (пул вакансий, каталог, кэши, журналы): их список в
// db-backup-recollectable.txt. Новая таблица без строки в списке попадает в копию сама.
// Источник читается в одной транзакции: копия согласована на один момент. Тени FTS5 не пишутся
// напрямую (защищённый режим node:sqlite): поиск заполняется вставкой строк и индексируется заново.
// CLI: node dbBackupUserData.mjs <база> <копия> <файл шаблонов> → отчёт JSON на stdout.
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const FTS_SHADOWS = ['data', 'idx', 'content', 'docsize', 'config'];

/** Строки файла шаблонов: имя таблицы или префикс со «*»; «#» — комментарий. */
export function parsePatterns(text) {
  return text
    .split('\n')
    .map((line) => line.replace(/#.*/u, '').trim())
    .filter(Boolean);
}

export function isRecollectable(table, patterns) {
  return patterns.some((pattern) =>
    pattern.endsWith('*') ? table.startsWith(pattern.slice(0, -1)) : table === pattern,
  );
}

const quote = (name) => `"${name.replaceAll('"', '""')}"`;

/** Таблица-тень поиска: её создаёт сам CREATE VIRTUAL TABLE, а заполняет вставка в поисковую таблицу. */
function shadowParent(name, virtuals) {
  return virtuals.find((parent) => FTS_SHADOWS.some((suffix) => name === `${parent}_${suffix}`));
}

function readSchema(source) {
  const all = source
    .prepare(
      'SELECT type, name, tbl_name AS tbl, sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY rowid',
    )
    .all();
  const virtuals = all
    .filter((row) => row.type === 'table' && /^CREATE VIRTUAL/iu.test(row.sql))
    .map((row) => row.name);
  const tables = all.filter(
    (row) =>
      row.type === 'table' && !row.name.startsWith('sqlite_') && !shadowParent(row.name, virtuals),
  );
  const later = all.filter(
    (row) => row.type === 'index' || row.type === 'view' || row.type === 'trigger',
  );
  return { tables, later, virtuals, all };
}

function copyTable(source, target, table) {
  const columns = source
    .prepare(`PRAGMA table_xinfo(${quote(table)})`)
    .all()
    .filter((column) => column.hidden === 0)
    .map((column) => quote(column.name));
  const list = columns.join(', ');
  const insert = target.prepare(
    `INSERT INTO ${quote(table)} (${list}) VALUES (${columns.map(() => '?').join(', ')})`,
  );
  let rows = 0;
  for (const row of source.prepare(`SELECT ${list} FROM ${quote(table)}`).iterate()) {
    insert.run(...Object.values(row));
    rows += 1;
  }
  return rows;
}

/** Таблицы с данными: обычные и поисковые незаменимые (поиск пересобирается вставкой), sqlite_sequence. */
function dataTables(schema, patterns) {
  const plain = schema.tables
    .map((row) => row.name)
    .filter((name) => !isRecollectable(name, patterns));
  const sequence = schema.all.some((row) => row.name === 'sqlite_sequence')
    ? ['sqlite_sequence']
    : [];
  return { plain, refill: sequence };
}

export function copyUserData(sourcePath, targetPath, patterns) {
  const started = Date.now();
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const target = new DatabaseSync(targetPath);
  source.exec('BEGIN');
  try {
    const schema = readSchema(source);
    // Ссылки на пул и каталог в копии пустые: внешние ключи при переносе не проверяются
    // (полная копия и данные складываются при восстановлении).
    target.exec(
      'PRAGMA foreign_keys = OFF; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; BEGIN',
    );
    for (const row of schema.tables) target.exec(row.sql);
    const { plain, refill } = dataTables(schema, patterns);
    const rows = {};
    for (const table of plain) rows[table] = copyTable(source, target, table);
    for (const table of refill) {
      target.exec(`DELETE FROM ${quote(table)}`);
      rows[table] = copyTable(source, target, table);
    }
    // Индексы и триггеры — после данных: триггеры не срабатывают на переносе.
    for (const row of schema.later) target.exec(row.sql);
    target.exec('COMMIT');
    const skipped = schema.tables
      .map((row) => row.name)
      .filter((name) => isRecollectable(name, patterns))
      .sort();
    return { rows, skipped, ms: Date.now() - started };
  } finally {
    source.exec('COMMIT');
    source.close();
    target.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [sourcePath, targetPath, patternsPath] = process.argv.slice(2);
  const report = copyUserData(
    sourcePath,
    targetPath,
    parsePatterns(readFileSync(patternsPath, 'utf8')),
  );
  const total = Object.values(report.rows).reduce((sum, value) => sum + value, 0);
  process.stdout.write(
    `${JSON.stringify({ tables: Object.keys(report.rows).length, rows: total, skipped: report.skipped.length, ms: report.ms })}\n`,
  );
}
