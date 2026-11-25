/**
 * B803: `node salary-import.mjs <база>` < срезы.json; `--enable <имя>` и `--disable <имя>` меняют
 * флаг источника. Данные приходят из stdin: файла на хосте нет, в выводе только счётчики.
 */
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { applySqliteBusyTimeout } from '../../data/sqliteBusyTimeout';
import { importSalarySlices } from './salaryImport';
import { setSalarySourceEnabled } from './sqliteSalaryBenchmarkStore';

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

async function run(): Promise<void> {
  const [path = '', action, name = ''] = process.argv.slice(2);
  if (!existsSync(path)) throw new Error('database is not found');
  if (action !== undefined && action !== '--enable' && action !== '--disable')
    throw new Error('unknown action');
  const input = action ? undefined : await readInput();
  const database = new DatabaseSync(path);
  try {
    applySqliteBusyTimeout(database);
    if (action) {
      setSalarySourceEnabled(database, name, action === '--enable');
      process.stdout.write('source flag updated\n');
      return;
    }
    const results = importSalarySlices(database, input);
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
