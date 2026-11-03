import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { MARKET_TARGETS } from '../vacancies/jobspyFan';
import type { LinkedinJobCard } from './jobSearchParser';

/**
 * Чтение вакансий на сессии пула (решение владельца 03.11): дополнение к
 * гостевому поиску, потому что гость видит не все вакансии. Карточки
 * складываются в промежуточную таблицу; источник пула читает её и отдаёт
 * движку частичным чтением (срез не заменяется никогда).
 */

/** Страниц поиска вакансий в сутки на аккаунт; входят в общий лимит исполнителя (40). */
export const JOB_SEARCH_DAILY_PAGE_LIMIT = 12;
const JOB_CARD_RETENTION_MS = 30 * 24 * 60 * 60_000;
const JOB_CARD_READ_WINDOW_MS = 14 * 24 * 60 * 60_000;
const LATIN_TERM = /^[a-z0-9&+.,'\s-]{2,80}$/iu;
const UAE_LOCATIONS: readonly string[] = ['Dubai', 'Abu Dhabi', 'Sharjah', 'United Arab Emirates'];

export function ensureJobSearchSchema(database: DatabaseSync): void {
  database.exec(`CREATE TABLE IF NOT EXISTS linkedin_pool_job_cards (
    job_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    url TEXT NOT NULL,
    published_at TEXT,
    first_seen_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  ) STRICT`);
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_linkedin_pool_job_cards_seen ON linkedin_pool_job_cards(last_seen_at)',
  );
  database.exec(`CREATE TABLE IF NOT EXISTS linkedin_pool_job_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT`);
}

/** Включено по умолчанию; строка в настройках появляется только после решения в админке. */
export function isPoolJobReadingEnabled(database: DatabaseSync): boolean {
  try {
    const row = database
      .prepare('SELECT enabled FROM linkedin_pool_job_settings WHERE id = 1')
      .get() as { enabled: number } | undefined;
    return row ? row.enabled === 1 : true;
  } catch {
    return true;
  }
}

export function setPoolJobReadingEnabled(database: DatabaseSync, enabled: boolean, now: Date): void {
  database
    .prepare(
      `INSERT INTO linkedin_pool_job_settings (id, enabled, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
    )
    .run(enabled ? 1 : 0, now.toISOString());
}

/** Один поисковый лист на каждые две остальные страницы, не больше суточного лимита. */
export function shouldReadJobsNow(usage: { jobPages: number; otherPages: number }): boolean {
  if (usage.jobPages >= JOB_SEARCH_DAILY_PAGE_LIMIT) return false;
  return usage.jobPages * 2 <= usage.otherPages;
}

export function saveJobCards(database: DatabaseSync, cards: readonly LinkedinJobCard[], now: Date): void {
  const timestamp = now.toISOString();
  const upsert = database.prepare(
    `INSERT INTO linkedin_pool_job_cards
       (job_id, title, company, location, url, published_at, first_seen_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(job_id) DO UPDATE SET title = excluded.title, company = excluded.company,
       location = excluded.location, url = excluded.url,
       published_at = coalesce(excluded.published_at, published_at),
       last_seen_at = excluded.last_seen_at`,
  );
  for (const card of cards) {
    upsert.run(
      card.jobId, card.title, card.company, card.location, card.url,
      card.publishedAt ?? null, timestamp, timestamp,
    );
  }
  database
    .prepare('DELETE FROM linkedin_pool_job_cards WHERE last_seen_at < ?')
    .run(new Date(now.getTime() - JOB_CARD_RETENTION_MS).toISOString());
}

export interface PoolJobCardRow extends LinkedinJobCard {
  readonly lastSeenAt: string;
}

export function readPoolJobCards(database: DatabaseSync, now: Date, limit: number): PoolJobCardRow[] {
  const rows = database
    .prepare(
      `SELECT job_id, title, company, location, url, published_at, last_seen_at
       FROM linkedin_pool_job_cards WHERE last_seen_at >= ?
       ORDER BY last_seen_at DESC LIMIT ?`,
    )
    .all(new Date(now.getTime() - JOB_CARD_READ_WINDOW_MS).toISOString(), limit) as Array<{
    job_id: string; title: string; company: string; location: string; url: string;
    published_at: string | null; last_seen_at: string;
  }>;
  return rows.map((row) => ({
    jobId: row.job_id,
    title: row.title,
    company: row.company,
    location: row.location,
    url: row.url,
    ...(row.published_at ? { publishedAt: row.published_at } : {}),
    lastSeenAt: row.last_seen_at,
  }));
}

/** Роли спроса кандидатов (vacancy_demand_terms), новые первыми; без таблицы — пусто. */
export function readDemandTerms(database: DatabaseSync, limit = 40): string[] {
  try {
    return (
      database
        .prepare('SELECT term FROM vacancy_demand_terms ORDER BY first_seen_ms DESC, term LIMIT ?')
        .all(limit) as Array<{ term: string }>
    ).map((row) => row.term);
  } catch {
    return [];
  }
}

export interface JobSearchQuery {
  readonly term: string;
  readonly location: string;
  readonly hash: string;
}

export function jobSearchQueryHash(term: string, location: string): string {
  return createHash('sha256').update(`${term.toLowerCase()}|${location.toLowerCase()}`).digest('hex');
}

/**
 * Чётная по счёту страница суток читает ОАЭ, нечётная — остальные рынки; старт
 * сдвигается по дню, чтобы круг ролей × рынков проходился за несколько суток.
 */
export function nextJobSearchQuery(input: {
  readonly demandTerms: readonly string[];
  readonly jobPagesToday: number;
  readonly dayIndex: number;
  readonly attemptedHashes: readonly string[];
}): JobSearchQuery | undefined {
  const terms = input.demandTerms.map((t) => t.trim()).filter((t) => LATIN_TERM.test(t));
  if (terms.length === 0) return undefined;
  const uae = input.jobPagesToday % 2 === 0;
  const locations = uae
    ? UAE_LOCATIONS
    : [...new Set(MARKET_TARGETS.map((t) => t.location))].filter((l) => !UAE_LOCATIONS.includes(l));
  const total = terms.length * locations.length;
  const attempted = new Set(input.attemptedHashes);
  const start = (Math.max(0, input.dayIndex) * 7) % total;
  for (let step = 0; step < total; step += 1) {
    const index = (start + step) % total;
    const term = terms[index % terms.length]!;
    const location = locations[Math.floor(index / terms.length) % locations.length]!;
    const hash = jobSearchQueryHash(term, location);
    if (!attempted.has(hash)) return { term, location, hash };
  }
  return undefined;
}
