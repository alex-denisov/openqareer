/**
 * Telegram alert when the indexable set falls (04.11).
 *
 * The 7-day rule closed 3 834 pages from 24.10 and it took ten days to notice;
 * the sitemap job had the numbers all along. Replayed on the journal 25.10–04.11,
 * this rule fires on 27.10 for cards and listings and never during normal drift
 * (a day's own swing stays under 20 %). It compares counts, not a noindex share:
 * the catalog itself grows and shrinks by whole sources, which says nothing about
 * what we ask search engines to index.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  notifyOwner,
  type OwnerTelegramConfig,
  type OwnerTelegramOutcome,
} from '../notifications/ownerTelegram';

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS catalog_index_coverage (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  best INTEGER NOT NULL,
  alerted_at TEXT,
  PRIMARY KEY (day, kind)
) STRICT, WITHOUT ROWID`;

/** The largest fall the normal drift of the sitemap files has shown stays below this. */
const DROP_RATIO = 0.8;
const BASELINE_DAYS = 7;
const KEEP_DAYS = 30;
const DAY_MS = 86_400_000;

const KINDS = [
  { kind: 'jobs', prefix: 'jobs-', label: 'карточек вакансий' },
  { kind: 'listings', prefix: 'listings-', label: 'списков вакансий' },
] as const;

export interface IndexCoverageDeps {
  readonly database: DatabaseSync;
  readonly files: ReadonlyArray<{ readonly name: string; readonly urlCount: number }>;
  readonly telegram: OwnerTelegramConfig;
  readonly log: { error(details: Record<string, unknown>, message: string): void };
  readonly now?: Date;
  readonly notify?: (config: OwnerTelegramConfig, text: string) => Promise<OwnerTelegramOutcome>;
}

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

async function checkKind(
  deps: IndexCoverageDeps,
  { kind, prefix, label }: (typeof KINDS)[number],
  now: Date,
): Promise<void> {
  const { database } = deps;
  const today = isoDay(now.getTime());
  const count = deps.files
    .filter((file) => file.name.startsWith(prefix))
    .reduce((sum, file) => sum + file.urlCount, 0);
  const earlier = database
    .prepare(
      `SELECT max(best) AS baseline, max(alerted_at) AS alerted FROM catalog_index_coverage
        WHERE kind = ? AND day >= ? AND day < ?`,
    )
    .get(kind, isoDay(now.getTime() - BASELINE_DAYS * DAY_MS), today) as {
    baseline: number | null;
    alerted: string | null;
  };
  const alertedToday = database
    .prepare('SELECT alerted_at FROM catalog_index_coverage WHERE kind = ? AND day = ?')
    .get(kind, today) as { alerted_at: string | null } | undefined;
  database
    .prepare(
      `INSERT INTO catalog_index_coverage (day, kind, best) VALUES (?, ?, ?)
       ON CONFLICT (day, kind) DO UPDATE SET best = max(best, excluded.best)`,
    )
    .run(today, kind, count);

  const baseline = earlier.baseline ?? 0;
  if (count >= baseline * DROP_RATIO || earlier.alerted || alertedToday?.alerted_at) return;
  const percent = Math.round((1 - count / baseline) * 100);
  deps.log.error({ kind, count, baseline, percent }, 'catalog-index-coverage-drop');
  const outcome = await (deps.notify ?? notifyOwner)(
    deps.telegram,
    `В индексируемом наборе сайта стало меньше ${label}: ${count} против ${baseline} ` +
      `за прошлую неделю, минус ${percent} %. Проверьте правила индексации и данные каталога.`,
  );
  if (outcome.status === 'failed') {
    deps.log.error({ kind, reason: outcome.reason }, 'catalog-index-coverage-notify-failed');
    return;
  }
  database
    .prepare('UPDATE catalog_index_coverage SET alerted_at = ? WHERE day = ? AND kind = ?')
    .run(now.toISOString(), today, kind);
}

/** One check after the sitemap files are written. Never throws into the sitemap job. */
export async function checkIndexCoverage(deps: IndexCoverageDeps): Promise<void> {
  const now = deps.now ?? new Date();
  try {
    deps.database.exec(TABLE_SQL);
    for (const kind of KINDS) await checkKind(deps, kind, now);
    deps.database
      .prepare('DELETE FROM catalog_index_coverage WHERE day < ?')
      .run(isoDay(now.getTime() - KEEP_DAYS * DAY_MS));
  } catch (error: unknown) {
    deps.log.error(
      { errorName: error instanceof Error ? error.name : 'UnknownError' },
      'catalog-index-coverage-failed',
    );
  }
}
