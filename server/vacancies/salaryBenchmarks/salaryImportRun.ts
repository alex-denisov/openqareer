/**
 * B803: `node salary-import.mjs <база> [--dry-run]` < срезы.json; `--enable <имя>` и `--disable <имя>`
 * меняют флаг источника, `--exclude <имя> <страна>` и `--include` — одну его страну. Данные приходят из stdin: файла на хосте нет, в выводе только счётчики.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../../data/sqliteBusyTimeout';
import { importSalarySlices } from './salaryImport';
import { setSalaryCountryExcluded, setSalarySourceEnabled } from './sqliteSalaryBenchmarkStore';

const MAX_BYTES = 64 * 1024 * 1024;

async function readInput(): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk as Uint8Array);
    size += bytes.length;
    if (size > MAX_BYTES) throw new Error('input is too large');
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    // Сообщение разбора цитирует вход.
    throw new Error('input is not JSON');
  }
}

const FLAG_ACTIONS: Readonly<
  Partial<Record<string, (database: DatabaseSync, name: string, country: string) => void>>
> = {
  '--enable': (database, name) => setSalarySourceEnabled(database, name, true),
  '--disable': (database, name) => setSalarySourceEnabled(database, name, false),
  '--exclude': (database, name, country) => setSalaryCountryExcluded(database, name, country, true),
  '--include': (database, name, country) =>
    setSalaryCountryExcluded(database, name, country, false),
};

async function run(): Promise<void> {
  const [path = '', action = '', name = '', country = ''] = process.argv.slice(2);
  if (!existsSync(path)) throw new Error('database is not found');
  const dryRun = action === '--dry-run';
  const change = FLAG_ACTIONS[action];
  if (action && !dryRun && !change) throw new Error('unknown action');
  const input = change ? undefined : await readInput();
  const database = new DatabaseSync(path, { readOnly: dryRun });
  try {
    applySqliteBusyTimeout(database);
    if (change) {
      change(database, name, country);
      process.stdout.write('source flag updated\n');
      return;
    }
    const results = importSalarySlices(database, input, dryRun);
    process.stdout.write(`${JSON.stringify(results)}\n`);
    if (results.some(({ error }) => error)) process.exitCode = 1;
  } finally {
    database.close();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(
    `salary import failed: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown'}\n`,
  );
  process.exitCode = 1;
});
