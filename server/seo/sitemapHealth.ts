/**
 * Daily sitemap check (owner, 11.11).
 *
 * `scripts/seo/verify-sitemap.mjs` walks every sitemap address by hand; this
 * runs in the maintenance process once a UTC day on a random sample of 2 000,
 * with the same rules (`sitemapRules.ts`). An address that fails is opened once
 * more after a pause: a card closed between the sitemap read and its turn is
 * drift, not a defect. The result goes to the journal (`sitemap-health`) and to
 * the owner's Telegram in plain words.
 */
import type { DatabaseSync } from 'node:sqlite';
import { SITE_ORIGIN } from '../../shared/aeoSurface';
import {
  notifyOwner,
  type OwnerTelegramConfig,
  type OwnerTelegramOutcome,
} from '../notifications/ownerTelegram';
import { checkUrl, extractLocs, isSitemapIndex, parseRobotsDisallow } from './sitemapRules';

export const SITEMAP_HEALTH_SAMPLE = 2_000;
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 20_000;
/** A job file is built live from the catalog; right after a deploy that takes longer. */
const SITEMAP_TIMEOUT_MS = 120_000;
const SITEMAP_ATTEMPTS = 3;
const RECHECK_PAUSE_MS = 60_000;
const FIRST_RUN_MS = 10 * 60_000;
const TICK_MS = 60 * 60_000;
const EXAMPLES = 5;
const USER_AGENT = 'Mozilla/5.0 (compatible; openqareer-sitemap-health/1.0)';

const TABLE_SQL = `CREATE TABLE IF NOT EXISTS sitemap_health_runs (
  day TEXT PRIMARY KEY,
  checked INTEGER NOT NULL,
  violations INTEGER NOT NULL,
  finished_at TEXT NOT NULL
) STRICT, WITHOUT ROWID`;

export interface SitemapViolation {
  readonly url: string;
  readonly problems: readonly string[];
}

export interface SitemapHealthResult {
  readonly total: number;
  readonly checked: number;
  readonly violations: readonly SitemapViolation[];
}

export interface SitemapHealthOptions {
  readonly origin?: string;
  readonly fetcher?: typeof fetch;
  readonly sampleSize?: number;
  readonly random?: () => number;
  readonly pause?: () => Promise<void>;
}

interface Fetched {
  readonly status: number;
  readonly location: string | null;
  readonly headers: Record<string, string>;
  readonly html: string;
}

async function get(
  fetcher: typeof fetch,
  url: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Fetched> {
  try {
    const response = await fetcher(url, {
      redirect: 'manual',
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const html = await response.text();
    return {
      status: response.status,
      location: response.headers.get('location'),
      headers: Object.fromEntries(response.headers),
      html,
    };
  } catch {
    return { status: 0, location: null, headers: {}, html: '' };
  }
}

async function getSitemap(fetcher: typeof fetch, url: string): Promise<Fetched> {
  let last = await get(fetcher, url, SITEMAP_TIMEOUT_MS);
  for (let attempt = 1; attempt < SITEMAP_ATTEMPTS && last.status !== 200; attempt += 1) {
    last = await get(fetcher, url, SITEMAP_TIMEOUT_MS);
  }
  return last;
}

async function sitemapUrls(fetcher: typeof fetch, origin: string): Promise<string[]> {
  const index = await getSitemap(fetcher, `${origin}/sitemap.xml`);
  if (index.status !== 200) throw new Error(`sitemap_${index.status}`);
  if (!isSitemapIndex(index.html)) return extractLocs(index.html);
  const urls: string[] = [];
  for (const child of extractLocs(index.html)) {
    const file = await getSitemap(fetcher, child);
    if (file.status !== 200) throw new Error(`sitemap_child_${file.status}`);
    urls.push(...extractLocs(file.html));
  }
  return urls;
}

/** Partial Fisher–Yates: a uniform sample without copying the order twice. */
export function sampleOf<T>(items: readonly T[], size: number, random: () => number): T[] {
  const copy = [...items];
  const count = Math.min(size, copy.length);
  for (let index = 0; index < count; index += 1) {
    const pick = index + Math.floor(random() * (copy.length - index));
    [copy[index], copy[pick]] = [copy[pick] as T, copy[index] as T];
  }
  return copy.slice(0, count);
}

async function checkAll(
  fetcher: typeof fetch,
  urls: readonly string[],
  disallow: readonly string[],
): Promise<SitemapViolation[]> {
  const violations: SitemapViolation[] = [];
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++] as string;
      const problems = checkUrl({ url, ...(await get(fetcher, url)) }, disallow);
      if (problems.length > 0) violations.push({ url, problems });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return violations.sort((a, b) => a.url.localeCompare(b.url));
}

export async function runSitemapHealth(
  options: SitemapHealthOptions = {},
): Promise<SitemapHealthResult> {
  const origin = options.origin ?? SITE_ORIGIN;
  const fetcher = options.fetcher ?? fetch;
  const robots = await get(fetcher, `${origin}/robots.txt`);
  const disallow = robots.status === 200 ? parseRobotsDisallow(robots.html) : [];
  const all = await sitemapUrls(fetcher, origin);
  const sample = sampleOf(
    all,
    options.sampleSize ?? SITEMAP_HEALTH_SAMPLE,
    options.random ?? Math.random,
  );
  const first = await checkAll(fetcher, sample, disallow);
  if (first.length > 0) {
    await (
      options.pause ?? (() => new Promise((resolve) => setTimeout(resolve, RECHECK_PAUSE_MS)))
    )();
  }
  const stable =
    first.length > 0
      ? await checkAll(
          fetcher,
          first.map((v) => v.url),
          disallow,
        )
      : [];
  return { total: all.length, checked: sample.length, violations: stable };
}

/** Plain words for the owner: no status codes, tags or rule names. */
function kindOf(problem: string): string {
  if (/^status 3\d\d/u.test(problem)) return 'ведёт на другой адрес';
  if (problem.startsWith('status')) return 'не открывается';
  if (/noindex|robots/u.test(problem)) return 'закрыта от поиска';
  if (/canonical/u.test(problem)) return 'указывает поиску на другую страницу';
  return 'лишний адрес в карте сайта';
}

function count(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ' ');
}

export function healthMessage(result: SitemapHealthResult): string {
  const head = `Проверка карты сайта: открыли ${count(result.checked)} случайных страниц из ${count(result.total)}`;
  if (result.violations.length === 0) return `${head}, все открываются и доступны поиску.`;
  const kinds = new Map<string, number>();
  for (const violation of result.violations) {
    const kind = kindOf(violation.problems[0] ?? '');
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  const breakdown = [...kinds].map(([kind, n]) => `${kind}: ${count(n)}`).join(', ');
  const examples = result.violations
    .slice(0, EXAMPLES)
    .map((v) => v.url)
    .join('\n');
  return (
    `${head}. С ошибками ${count(result.violations.length)} из ${count(result.checked)}: ${breakdown}. ` +
    `Примеры:\n${examples}`
  );
}

export function sitemapHealthDue(database: DatabaseSync, now: Date): boolean {
  database.exec(TABLE_SQL);
  return !database
    .prepare('SELECT 1 FROM sitemap_health_runs WHERE day = ?')
    .get(now.toISOString().slice(0, 10));
}

interface HealthLog {
  info(details: Record<string, unknown>, message: string): void;
  error(details: Record<string, unknown>, message: string): void;
}

export interface SitemapHealthJobDeps {
  readonly database: DatabaseSync;
  readonly log: HealthLog;
  readonly telegram: OwnerTelegramConfig;
  readonly now?: () => Date;
  readonly check?: () => Promise<SitemapHealthResult>;
  readonly notify?: (config: OwnerTelegramConfig, text: string) => Promise<OwnerTelegramOutcome>;
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 80) : 'UnknownError';
}

/** One run if today has none; never throws into the maintenance process. */
export async function runSitemapHealthJob(deps: SitemapHealthJobDeps): Promise<void> {
  const now = (deps.now ?? (() => new Date()))();
  try {
    if (!sitemapHealthDue(deps.database, now)) return;
    const started = Date.now();
    const result = await (deps.check ?? (() => runSitemapHealth()))();
    deps.database
      .prepare(
        `INSERT INTO sitemap_health_runs (day, checked, violations, finished_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (day) DO NOTHING`,
      )
      .run(
        now.toISOString().slice(0, 10),
        result.checked,
        result.violations.length,
        new Date().toISOString(),
      );
    deps.log.info(
      {
        total: result.total,
        checked: result.checked,
        violations: result.violations.length,
        examples: result.violations
          .slice(0, EXAMPLES)
          .map((v) => `${v.url} ${v.problems.join('; ')}`),
        ms: Date.now() - started,
      },
      'sitemap-health',
    );
    const outcome = await (deps.notify ?? notifyOwner)(deps.telegram, healthMessage(result));
    if (outcome.status === 'failed') {
      deps.log.error({ reason: outcome.reason }, 'sitemap-health-notify-failed');
    }
  } catch (error: unknown) {
    deps.log.error({ reason: errorReason(error) }, 'sitemap-health-failed');
  }
}

/** Maintenance process only: checks hourly whether today's run is still due. */
export function scheduleSitemapHealth(
  database: DatabaseSync,
  log: HealthLog,
  telegram: OwnerTelegramConfig,
): () => void {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await runSitemapHealthJob({ database, log, telegram });
    } finally {
      running = false;
    }
  };
  const first = setTimeout(() => void run(), FIRST_RUN_MS);
  const every = setInterval(() => void run(), TICK_MS);
  first.unref();
  every.unref();
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
