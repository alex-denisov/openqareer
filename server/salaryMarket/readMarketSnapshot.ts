import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { SalaryMarketSnapshot } from '../../shared/salaryMarketSnapshot';
import { readSalaryMarketSnapshot } from './salaryMarketSnapshot';

/** Готовый расчёт роли: одно чтение по ключу; базы или расчёта нет — `null`. */
export function readMarketSnapshot(
  databasePath: string,
  role: string,
): SalaryMarketSnapshot | null {
  if (!existsSync(databasePath)) return null;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return readSalaryMarketSnapshot(database, role);
  } finally {
    database.close();
  }
}
