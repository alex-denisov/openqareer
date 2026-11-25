import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * B759: отпечаток кода процесса обслуживания. Выкат сравнивает его с
 * работающим и не перезапускает обслуживание, если код тот же.
 *
 * Строка релиза вшита в бандл (`__OPENQAREER_RELEASE__`) и меняется на каждом
 * выкате, поэтому перед хэшем она заменяется константой. В отпечаток входят и
 * источники схемы веб-процесса: если веб мигрирует базу, обслуживание обязано
 * перезапуститься на новом коде, даже когда его бандл не изменился.
 */

/** Файлы, которые читает процесс обслуживания (каталоги — целиком). */
export const MAINTENANCE_FILES = [
  'maintenance.mjs',
  'site-render-worker.mjs',
  'freehire-pages-worker.mjs',
  'heavy-read-worker.mjs',
  'data',
];

export const MECHANICS_FILES = ['vacancy-mechanics-worker.mjs'];

const DDL =
  /\b(CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER|VIEW|VIRTUAL\s+TABLE)|ALTER\s+TABLE|DROP\s+(?:TABLE|INDEX|TRIGGER|VIEW))\b/i;

function filesUnder(root, entry) {
  const path = join(root, entry);
  if (!existsSync(path)) throw new Error(`fingerprint: ${entry} is missing in ${root}`);
  if (!statSync(path).isDirectory()) return [entry];
  return readdirSync(path)
    .sort()
    .flatMap((name) => filesUnder(root, relative(root, join(path, name))));
}

/**
 * Оператор DDL целиком: от ключевого слова до `;` или конца шаблонной строки.
 * Пробелы схлопываются: перенос строки в схеме — не смена схемы.
 */
const DDL_STATEMENT = new RegExp(`${DDL.source}[^;\`]*`, 'gi');

/**
 * Только операторы DDL файла: правка кода рядом со схемой не перезапускает обслуживание.
 * Оператор с подстановкой (`ALTER TABLE x ADD COLUMN ${name}`) зависит от кода файла —
 * списка колонок, имени таблицы, — поэтому такой файл входит в отпечаток целиком.
 */
export function schemaStatementsOf(text) {
  const statements = text.match(DDL_STATEMENT) ?? [];
  if (statements.some((statement) => statement.includes('${'))) return text;
  return statements.map((statement) => statement.replace(/\s+/g, ' ').trim()).join('\n');
}

/** Модули сервера из сборки веб-процесса, в которых есть DDL, по порядку пути, — их операторы DDL. */
export function schemaSourcesOf(metafile, readText = (path) => readFileSync(path, 'utf8')) {
  return Object.keys(metafile.inputs)
    .filter((path) => path.startsWith('server/'))
    .sort()
    .map((path) => ({ path, text: schemaStatementsOf(readText(path)) }))
    .filter((source) => source.text.length > 0);
}

/** Таблица оператора; у триггера, DROP INDEX и прочего её по тексту не узнать. */
const STATEMENT_TABLE =
  /^(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+\S+\s+ON)\s+["'[]?(\w+)/i;

/**
 * Прод 25.11: выкаты с новой таблицей веба (`manual_apply_*`) перезапускали обслуживание при
 * побайтно том же бандле. Таблицу, имени которой в бандле нет, процесс не читает и не пишет.
 */
export function schemaSourcesUsedBy(bundleText, schemaSources) {
  const names = new Set(bundleText.match(/\w+/g) ?? []);
  const used = (statement) => {
    const table = STATEMENT_TABLE.exec(statement)?.[1];
    return table === undefined || names.has(table);
  };
  return schemaSources
    .map((source) =>
      // Файл с подстановкой в DDL входит целиком: от него зависит неизвестная таблица.
      source.text.includes('${')
        ? source
        : { ...source, text: source.text.split('\n').filter(used).join('\n') },
    )
    .filter((source) => source.text.length > 0);
}

export function fingerprintOf(distDir, entries, release, schemaSources) {
  const hash = createHash('sha256');
  const files = entries.flatMap((entry) => filesUnder(distDir, entry));
  for (const file of files) {
    let bytes = readFileSync(join(distDir, file));
    if (release && /^[0-9a-f]{40}$/.test(release)) {
      bytes = Buffer.from(bytes.toString('latin1').replaceAll(release, '<release>'), 'latin1');
    }
    hash.update(`file\0${file}\0${bytes.length}\0`).update(bytes);
  }
  for (const source of schemaSources) {
    hash.update(`schema\0${source.path}\0`).update(source.text);
  }
  return hash.digest('hex');
}

/** Пишет `maintenance.fingerprint` и `vacancy-mechanics.fingerprint` в dist. */
export function writeFingerprints(distDir, release, serverMetafile) {
  const schema = schemaSourcesOf(serverMetafile);
  const outputs = [
    ['maintenance.fingerprint', MAINTENANCE_FILES],
    ['vacancy-mechanics.fingerprint', MECHANICS_FILES],
  ];
  for (const [name, entries] of outputs) {
    const bundleText = entries
      .filter((entry) => entry.endsWith('.mjs'))
      .map((entry) => readFileSync(join(distDir, entry), 'utf8'))
      .join('\n');
    const used = schemaSourcesUsedBy(bundleText, schema);
    writeFileSync(join(distDir, name), `${fingerprintOf(distDir, entries, release, used)}\n`);
  }
}
