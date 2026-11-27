import type { DatabaseSync } from 'node:sqlite';
import type { DirectoryCompany } from './companyDirectorySources';

/**
 * B646-5: доски Paylocity, Join и Paycom живут в местах размещения
 * (`company_placement`). По директиве владельца включаются партиями от даты старта
 * без исключения провайдеров.
 */
export const PLACEMENT_ROLLOUT_PROVIDERS = ['paylocity', 'join', 'paycom'] as const;
export const PLACEMENT_ROLLOUT_START_MS = Date.UTC(2026, 10, 11);
export const PLACEMENT_BOARDS_PER_DAY = 300;

export function admittedPlacementBoards(nowMs: number): number {
  const days = Math.floor((nowMs - PLACEMENT_ROLLOUT_START_MS) / 86_400_000);
  return days < 0 ? 0 : (days + 1) * PLACEMENT_BOARDS_PER_DAY;
}

interface PlacementRow {
  company_key: string;
  company_name: string | null;
  provider: string;
  slug: string;
}

function hasTable(database: DatabaseSync, tableName: string): boolean {
  return Boolean(
    database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName),
  );
}

function hasPlacementHealthColumn(database: DatabaseSync): boolean {
  const cols = database
    .prepare('PRAGMA table_info(company_placement)')
    .all() as unknown as { name: string }[];
  return cols.some((col) => col.name === 'health');
}

/** Только чтение: допущенные на сегодня доски, порядок по ключу места — партия не плавает. */
export function readRolloutPlacementBoards(
  database: DatabaseSync,
  nowMs: number,
): readonly DirectoryCompany[] {
  const limit = admittedPlacementBoards(nowMs);
  if (limit === 0 || !hasTable(database, 'company_placement')) return [];
  const healthClause = hasPlacementHealthColumn(database)
    ? "AND (p.health IS NULL OR p.health NOT IN ('gone', 'disabled'))"
    : '';
  const hasDir = hasTable(database, 'company_directory');
  const read = database.prepare(
    hasDir
      ? `SELECT p.company_key, d.company_name, p.provider, p.slug
           FROM company_placement p LEFT JOIN company_directory d ON d.company_key = p.company_key
          WHERE p.type = 'ats' AND p.provider = ? AND p.slug IS NOT NULL AND p.slug != ''
            ${healthClause}
          ORDER BY p.placement_id LIMIT ?`
      : `SELECT p.company_key, NULL AS company_name, p.provider, p.slug
           FROM company_placement p
          WHERE p.type = 'ats' AND p.provider = ? AND p.slug IS NOT NULL AND p.slug != ''
            ${healthClause}
          ORDER BY p.placement_id LIMIT ?`,
  );
  return PLACEMENT_ROLLOUT_PROVIDERS.flatMap((provider) =>
    (read.all(provider, limit) as unknown as PlacementRow[])
      .filter((row) => provider !== 'join' || /^\d+$/.test(row.slug.trim()))
      .map((row) => ({
        companyKey: row.company_key,
        companyName: row.company_name ?? row.company_key,
        websiteUrl: null,
        careersUrl: null,
        linkedinOrgId: null,
        atsProvider: row.provider,
        atsSlug: row.slug.trim(),
      })),
  );
}
