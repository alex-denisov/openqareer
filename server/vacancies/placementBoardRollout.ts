import type { DatabaseSync } from 'node:sqlite';
import type { DirectoryCompany } from './companyDirectorySources';

/**
 * B646-5: доски Paylocity и Join живут только в местах размещения
 * (`company_placement`, около 23 тыс.). Решение CPO 11.11: включать партиями,
 * как B641 — по 300 досок каждой ATS в сутки от даты старта; рост партии
 * только по замерам стоянок, памяти и базы, не больше ×1,5 за шаг.
 * Paycom не включается: его robots.txt запрещает эндпоинт списка.
 */
export const PLACEMENT_ROLLOUT_PROVIDERS = ['paylocity', 'join'] as const;
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

/** Только чтение: допущенные на сегодня доски, порядок по ключу места — партия не плавает. */
export function readRolloutPlacementBoards(
  database: DatabaseSync,
  nowMs: number,
): readonly DirectoryCompany[] {
  const table = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'company_placement'")
    .get();
  const limit = admittedPlacementBoards(nowMs);
  if (!table || limit === 0) return [];
  const read = database.prepare(
    `SELECT p.company_key, d.company_name, p.provider, p.slug
       FROM company_placement p LEFT JOIN company_directory d ON d.company_key = p.company_key
      WHERE p.type = 'ats' AND p.provider = ? AND p.slug IS NOT NULL AND p.slug != ''
      ORDER BY p.placement_id LIMIT ?`,
  );
  return PLACEMENT_ROLLOUT_PROVIDERS.flatMap((provider) =>
    (read.all(provider, limit) as unknown as PlacementRow[]).map((row) => ({
      companyKey: row.company_key,
      companyName: row.company_name ?? row.company_key,
      websiteUrl: null,
      careersUrl: null,
      linkedinOrgId: null,
      atsProvider: row.provider,
      atsSlug: row.slug,
    })),
  );
}
