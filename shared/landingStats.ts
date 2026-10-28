/**
 * B535: live numbers and featured vacancies on the landing.
 *
 * The landing is prerendered at build time with tokens; the server replaces
 * them with a cached snapshot of the pool on every request, so the served HTML
 * (what crawlers and the first paint see) always carries current numbers and a
 * date (DESIGN.md: no number without source and date). The same snapshot is
 * embedded as JSON for the client, so hydration renders identical text.
 *
 * Featured rows never carry a company name (owner decision 20.10: may be stale
 * and sensitive) and only ever include vacancies with a stated salary.
 */
export interface LandingVacancy {
  readonly title: string;
  readonly salary: string;
  readonly country: string;
}

/** A row of the live feed: a card of the open catalog (B569). */
export interface LandingFeedRow {
  readonly title: string;
  readonly salary: string;
  /** «Москва · hh.ru · 26.10». */
  readonly meta: string;
  /** Path of the public card, `/vacancies/job/<slug>`. */
  readonly href: string;
}

export interface LandingStats {
  readonly activeCount: number;
  readonly sourceCount: number;
  readonly remoteCount: number;
  /** ISO date (YYYY-MM-DD) of the pool reading. */
  readonly updatedAt: string;
  readonly vacancies: readonly LandingVacancy[];
  /** Newest salaried cards of the open catalog; absent until the next reading. */
  readonly feed?: readonly LandingFeedRow[];
}

export const LANDING_VACANCY_ROWS = 7;
/** Rows the feed paints in HTML; the ticker takes the rest from the JSON. */
export const LANDING_FEED_SHOWN = 5;
export const LANDING_FEED_ROWS = 12;
/** Sources the hero names one by one: hh.ru, LinkedIn, Telegram, company sites. */
export const LANDING_NAMED_SOURCES = 4;
export const LANDING_STATS_SCRIPT_ID = 'oq-landing-stats';

/**
 * Real pool reading of 2026-10-20 (prod SQL, owner-approved mockup v18). Served
 * only until the first background reading of the live pool is cached.
 */
export const LANDING_STATS_SNAPSHOT: LandingStats = {
  // B545: unique vacancies of the catalog, not 1.1 M records with repeats.
  activeCount: 712_000,
  sourceCount: 324,
  remoteCount: 155_319,
  updatedAt: '2026-10-26',
  vacancies: [
    { title: 'Manager II, Developer Advocacy', salary: '$212–265 тыс. в год', country: 'США' },
    {
      title: 'Backend-разработчик PHP/Symfony',
      salary: '220–250 тыс. ₽ в месяц',
      country: 'Россия',
    },
    { title: 'Директор по логистике', salary: '350–600 тыс. ₽ в месяц', country: 'Россия' },
    { title: 'Analytics Engineer', salary: '$164–230 тыс. в год', country: 'США' },
    { title: 'Head of Retention', salary: '€5–6 тыс. в месяц', country: 'Кипр' },
    { title: 'Sr. Director, Regional Sales', salary: '$197–353 тыс. в год', country: 'США' },
    { title: 'Главный бухгалтер', salary: '120–150 тыс. ₽ в месяц', country: 'Россия' },
  ],
};

/** 1 119 270 → «1,1 млн», 155 319 → «155 тыс.», 324 → «324». */
export function formatPoolCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(Math.floor(value / 100_000) / 10).toLocaleString('ru-RU')} млн`;
  }
  if (value >= 10_000) return `${Math.floor(value / 1_000)} тыс.`;
  return value.toLocaleString('ru-RU');
}

/** Russian plural for «источник». */
export function sourcesWord(value: number): string {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 'источник';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'источника';
  return 'источников';
}

/** 2026-10-20 → 20.10.2026. */
export function formatPoolDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return year && month && day ? `${day}.${month}.${year}` : isoDate;
}

/** Tokens the prerenderer writes and the server replaces. */
export const LANDING_TOKENS = {
  active: '%%OQ_ACTIVE%%',
  sources: '%%OQ_SOURCES%%',
  sourcesWord: '%%OQ_SOURCES_WORD%%',
  /** Sources beyond the four named in the hero. */
  sourcesMore: '%%OQ_SOURCES_MORE%%',
  remote: '%%OQ_REMOTE%%',
  date: '%%OQ_DATE%%',
  json: '%%OQ_STATS_JSON%%',
  vacancy: (index: number, field: keyof LandingVacancy) =>
    `%%OQ_V${index}_${field.toUpperCase()}%%`,
  feed: (index: number, field: keyof LandingFeedRow) => `%%OQ_F${index}_${field.toUpperCase()}%%`,
} as const;

/** Catalog rows for the feed; before the first reading, the salaried rows with a link to the catalog. */
export function landingFeed(stats: LandingStats): readonly LandingFeedRow[] {
  if (stats.feed && stats.feed.length >= LANDING_FEED_SHOWN) return stats.feed;
  return stats.vacancies.map((row) => ({
    title: row.title,
    salary: row.salary,
    meta: row.country,
    href: '/vacancies',
  }));
}

/** Stats object whose fields are the tokens themselves, for prerendering. */
export function landingTokenStats(): LandingStats {
  return {
    activeCount: -1,
    sourceCount: -1,
    remoteCount: -1,
    updatedAt: LANDING_TOKENS.date,
    vacancies: Array.from({ length: LANDING_VACANCY_ROWS }, (_, index) => ({
      title: LANDING_TOKENS.vacancy(index, 'title'),
      salary: LANDING_TOKENS.vacancy(index, 'salary'),
      country: LANDING_TOKENS.vacancy(index, 'country'),
    })),
    feed: Array.from({ length: LANDING_FEED_SHOWN }, (_, index) => ({
      title: LANDING_TOKENS.feed(index, 'title'),
      salary: LANDING_TOKENS.feed(index, 'salary'),
      meta: LANDING_TOKENS.feed(index, 'meta'),
      href: LANDING_TOKENS.feed(index, 'href'),
    })),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

/** JSON safe inside a `<script type="application/json">` element. */
export function landingStatsJson(stats: LandingStats): string {
  return JSON.stringify(stats).replace(/</gu, '\\u003c');
}

/** Replaces every landing token in the prerendered document. */
export function applyLandingStats(html: string, stats: LandingStats): string {
  if (!html.includes(LANDING_TOKENS.active)) return html;
  let out = html
    .split(LANDING_TOKENS.active)
    .join(escapeHtml(formatPoolCount(stats.activeCount)))
    .split(LANDING_TOKENS.sourcesWord)
    .join(sourcesWord(stats.sourceCount))
    .split(LANDING_TOKENS.sourcesMore)
    .join(String(Math.max(stats.sourceCount - LANDING_NAMED_SOURCES, 0)))
    .split(LANDING_TOKENS.sources)
    .join(String(stats.sourceCount))
    .split(LANDING_TOKENS.remote)
    .join(escapeHtml(formatPoolCount(stats.remoteCount)))
    .split(LANDING_TOKENS.date)
    .join(formatPoolDate(stats.updatedAt))
    .split(LANDING_TOKENS.json)
    .join(landingStatsJson(stats));
  for (let index = 0; index < LANDING_VACANCY_ROWS; index += 1) {
    const row = stats.vacancies[index] ?? LANDING_STATS_SNAPSHOT.vacancies[index];
    for (const field of ['title', 'salary', 'country'] as const) {
      out = out.split(LANDING_TOKENS.vacancy(index, field)).join(escapeHtml(row?.[field] ?? ''));
    }
  }
  const feed = landingFeed(stats);
  for (let index = 0; index < LANDING_FEED_SHOWN; index += 1) {
    const row = feed[index];
    for (const field of ['title', 'salary', 'meta', 'href'] as const) {
      out = out.split(LANDING_TOKENS.feed(index, field)).join(escapeHtml(row?.[field] ?? ''));
    }
  }
  return out;
}

const ENTRY_SCRIPT =
  /<script type="module" crossorigin src="(\/assets\/index-[^"]+\.js)"><\/script>/u;

/**
 * B535: public pages (landing, /faq, /support) are complete prerendered HTML;
 * the application bundle is fetched after the first interaction or a few
 * seconds, so it never competes with the first paint. Every other path keeps
 * the module script exactly as built.
 */
export function deferEntryScript(html: string): string {
  return html.replace(
    ENTRY_SCRIPT,
    // B574: until the bundle mounts, oq-chrome-2.js runs the header menus, so
    // the first tap on «Инструменты» or the phone menu is never lost.
    '<script defer src="/assets/oq-entry-loader-2.js" data-entry="$1"></script>' +
      '<script defer src="/assets/oq-chrome-2.js"></script>',
  );
}
