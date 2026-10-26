/**
 * B535: computes the landing's pool numbers and featured vacancies.
 *
 * Runs inside the maintenance process only: the counts scan the whole pool
 * index (5.5 s + 2.2 s measured on prod, 20.10) and must never run on the web
 * server's event loop. The result is one row in `landing_stats`; the web
 * server reads that row by primary key.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  LANDING_VACANCY_ROWS,
  type LandingStats,
  type LandingVacancy,
} from '../../shared/landingStats';

export const LANDING_STATS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS landing_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT`;

const CANDIDATE_ROWS = 600;

interface PoolSalary {
  readonly from?: number;
  readonly to?: number;
  readonly currency?: string;
}

interface PoolPayload {
  readonly title?: unknown;
  readonly salary?: PoolSalary | null;
  readonly location?: unknown;
}

const CURRENCY_COUNTRY: Record<string, string> = {
  RUR: 'Россия',
  RUB: 'Россия',
  KZT: 'Казахстан',
  BYR: 'Беларусь',
  BYN: 'Беларусь',
  UZS: 'Узбекистан',
};

const COUNTRY_NAMES: Record<string, string> = {
  'united states': 'США',
  usa: 'США',
  'united kingdom': 'Великобритания',
  germany: 'Германия',
  netherlands: 'Нидерланды',
  canada: 'Канада',
  cyprus: 'Кипр',
  кипр: 'Кипр',
  spain: 'Испания',
  portugal: 'Португалия',
  poland: 'Польша',
  serbia: 'Сербия',
  france: 'Франция',
  ireland: 'Ирландия',
  'united arab emirates': 'ОАЭ',
  israel: 'Израиль',
  australia: 'Австралия',
  georgia: 'Грузия',
  armenia: 'Армения',
};

const CURRENCY_SIGN: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' };

function thousands(value: number): string {
  return String(Math.round(value / 1_000));
}

/** «$212–265 тыс. в год», «220–250 тыс. ₽ в месяц», «от $4,5 тыс. в месяц». */
export function formatLandingSalary(salary: PoolSalary | null | undefined): string | null {
  if (!salary || !salary.currency) return null;
  const from = salary.from && salary.from > 0 ? salary.from : undefined;
  const rawTo = salary.to && salary.to > 0 ? salary.to : undefined;
  // «$60–60 тыс.»: a range with equal ends is one number.
  const to = rawTo !== undefined && rawTo === from ? undefined : rawTo;
  const top = to ?? from;
  if (!top) return null;
  const currency = salary.currency.toUpperCase();
  const rouble = currency === 'RUR' || currency === 'RUB';
  const sign = CURRENCY_SIGN[currency];
  if (!rouble && !sign) return null;
  if (rouble ? top < 30_000 : top < 1_000) return null; // hourly or unparsed amounts
  const yearly = !rouble && top >= 20_000;
  const period = yearly ? 'в год' : 'в месяц';
  const short = (value: number) =>
    !rouble && value < 10_000
      ? (value / 1_000).toLocaleString('ru-RU', { maximumFractionDigits: 1 })
      : thousands(value);
  const exact = salary.from !== undefined && salary.from === salary.to;
  const range =
    from && to
      ? `${short(from)}–${short(to)}`
      : exact
        ? `${sign ?? ''}${short(top)}`
        : `${from ? 'от' : 'до'} ${sign ?? ''}${short(top)}`;
  if (rouble) return from && to ? `${range} тыс. ₽ ${period}` : `${range} тыс. ₽ ${period}`;
  return from && to ? `${sign}${range} тыс. ${period}` : `${range} тыс. ${period}`;
}

/** Country of the employer from currency or location; null when unknown. */
export function landingCountry(payload: PoolPayload): string | null {
  const currency = payload.salary?.currency?.toUpperCase();
  if (currency && CURRENCY_COUNTRY[currency]) return CURRENCY_COUNTRY[currency] ?? null;
  const location = typeof payload.location === 'string' ? payload.location : '';
  const first = location.split(/[;,]/u)[0]?.trim().toLowerCase() ?? '';
  return COUNTRY_NAMES[first] ?? null;
}

/** Professional roles the landing's audience searches for (owner: «интересные позиции»). */
const ROLE_WORDS =
  /(руковод|директор|разработ|аналит|инженер|бухгалт|маркетол|дизайн|менеджер|продукт|engineer|developer|analyst|manager|director|head of|lead|architect|designer|product|scientist|accountant|marketing|devops|sre)/iu;
/** Roles outside the audience or listings that read as noise on a landing. */
const NOISE_WORDS =
  /(physician|nurse|dentist|teacher|tutor|instructor|driver|per diem|cashier|courier|closer|intern|future opening|assistant|ассистент|стажер|стажёр|курьер|(?:^|[^а-яё])водител|оператор|продав|кассир)/iu;

/** Drops board decorations such as «(#Удалёнка)» or trailing hashtags. */
export function cleanLandingTitle(raw: string): string {
  return raw
    .replace(/\(\s*#[^)]*\)/gu, ' ')
    .replace(/(^|\s)#[\p{L}\p{N}_-]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function isLandingTitle(title: string): boolean {
  return title.length <= 48 && ROLE_WORDS.test(title) && !NOISE_WORDS.test(title);
}

/** Up to seven salaried rows with a known country and distinct titles. */
export function pickLandingVacancies(payloads: readonly PoolPayload[]): LandingVacancy[] {
  const picked: LandingVacancy[] = [];
  const titles = new Set<string>();
  for (const payload of payloads) {
    if (picked.length >= LANDING_VACANCY_ROWS) break;
    const title = typeof payload.title === 'string' ? cleanLandingTitle(payload.title) : '';
    if (!title || !isLandingTitle(title) || titles.has(title.toLowerCase())) continue;
    const salary = formatLandingSalary(payload.salary);
    const country = landingCountry(payload);
    if (!salary || !country) continue;
    titles.add(title.toLowerCase());
    picked.push({ title, salary, country });
  }
  return picked;
}

/**
 * CPO 26.10: «Вакансии» пишут «из N вакансий каталога» по живым сведённым
 * вакансиям (B485), а лендинг считал записи по площадкам — вдвое больше.
 * Обещание лендинга берётся из того же итога каталога.
 */
function catalogTotal(database: DatabaseSync): number | undefined {
  const exists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'catalog_totals'")
    .get();
  if (!exists) return undefined;
  const row = database.prepare('SELECT catalog_total FROM catalog_totals WHERE id = 1').get() as
    | { catalog_total: number }
    | undefined;
  return row ? Number(row.catalog_total) : undefined;
}

export function computeLandingStats(database: DatabaseSync, now: Date): LandingStats {
  const counts = database
    .prepare(
      `SELECT count(*) AS active, sum(is_remote = 1) AS remote, count(DISTINCT source_id) AS sources
       FROM vacancy_pool_index WHERE is_active = 1 AND expired = 0`,
    )
    .get() as { active: number; remote: number | null; sources: number };
  const recent = (hh: boolean) =>
    database
      .prepare(
        `SELECT id FROM vacancy_pool_index
         WHERE is_active = 1 AND expired = 0 AND is_remote = 1
           AND (source_id = 'src-hh-search') = ?
         ORDER BY published_ms DESC LIMIT ?`,
      )
      .all(hh ? 1 : 0, CANDIDATE_ROWS) as { id: string }[];
  const readPayload = database.prepare('SELECT payload FROM vacancy_pool WHERE id = ?');
  const load = (rows: { id: string }[]) => {
    const payloads: PoolPayload[] = [];
    for (const { id } of rows) {
      const row = readPayload.get(id) as { payload: string } | undefined;
      if (!row) continue;
      try {
        payloads.push(JSON.parse(row.payload) as PoolPayload);
      } catch {
        // A malformed payload is skipped; the next row takes its place.
      }
    }
    return payloads;
  };
  // Russian and international vacancies alternate, so both audiences see their market.
  const russian = pickLandingVacancies(load(recent(true)));
  const abroad = pickLandingVacancies(load(recent(false)));
  const vacancies: LandingVacancy[] = [];
  for (
    let index = 0;
    vacancies.length < LANDING_VACANCY_ROWS && index < LANDING_VACANCY_ROWS;
    index += 1
  ) {
    for (const row of [abroad[index], russian[index]]) {
      if (row && vacancies.length < LANDING_VACANCY_ROWS) vacancies.push(row);
    }
  }
  return {
    activeCount: catalogTotal(database) ?? Number(counts.active),
    sourceCount: Number(counts.sources),
    remoteCount: Number(counts.remote ?? 0),
    updatedAt: now.toISOString().slice(0, 10),
    vacancies,
  };
}

export function writeLandingStats(database: DatabaseSync, stats: LandingStats, now: Date): void {
  database.exec(LANDING_STATS_TABLE_SQL);
  database
    .prepare(
      `INSERT INTO landing_stats (id, payload, updated_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
    )
    .run(JSON.stringify(stats), now.toISOString());
}

/** Primary-key read; null when the maintenance process has not written yet. */
export function readLandingStats(database: DatabaseSync): LandingStats | null {
  const exists = database
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'landing_stats'")
    .get();
  if (!exists) return null;
  const row = database.prepare('SELECT payload FROM landing_stats WHERE id = 1').get() as
    { payload: string } | undefined;
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.payload) as LandingStats;
    return Array.isArray(parsed.vacancies) && parsed.vacancies.length >= LANDING_VACANCY_ROWS
      ? parsed
      : null;
  } catch {
    return null;
  }
}
