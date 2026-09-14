import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import type { SourceReading } from './multiSourceVacancyEngine';
import { buildJsonVacancy, fromIso, isUsableVacancy } from './jsonVacancyRecord';
import { LINKEDIN_GUEST_URL } from './jobspyEndpoints';

/**
 * LinkedIn — гостевой список вакансий (B218). Механика JobSpy: адрес
 * `/jobs-guest/jobs/api/seeMoreJobPostings/search?start=N` отдаёт по 10
 * карточек в HTML без учётной записи. Учётку не вводим и капчу не решаем —
 * это простой GET.
 *
 * ПРАВО ПЛОЩАДКИ. robots.txt LinkedIn запрещает `/jobs-guest/` словами, а
 * шапка требует письменного разрешения на автосбор. Источник включён по
 * прямому, трижды повторённому решению владельца (B218) — оно записано в
 * реестре полем `robotsOverride`; без него движок туда не ходит. LinkedIn —
 * канал продвижения продукта (PRB-003), поэтому темп нарочито вежливый и на
 * 429 источник честно падает, а не давит дальше.
 */
export const LINKEDIN_SOURCE_ID = 'src-linkedin-guest';

/** Широкий охват белых воротничков, а не одна роль. */
const LINKEDIN_TERMS = 'engineer OR manager OR analyst OR developer OR designer';
const LINKEDIN_LOCATION = 'United States';
const LINKEDIN_PAGE = 10;
export const LINKEDIN_PAGES_PER_SYNC = 20;
const LINKEDIN_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
} as const;

export function linkedinGuestUrl(start: number): string {
  const url = new URL(LINKEDIN_GUEST_URL);
  url.searchParams.set('keywords', LINKEDIN_TERMS);
  url.searchParams.set('location', LINKEDIN_LOCATION);
  url.searchParams.set('start', String(start));
  return url.toString();
}

function attr(card: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`).exec(card);
  return m ? decodeEntities(m[1]!) : '';
}

function tagText(card: string, className: string): string {
  const m = new RegExp(`class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)<`, 'i').exec(card);
  return m ? decodeEntities(m[1]!.replace(/<[^>]+>/g, '').trim()) : '';
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Разбор одной страницы гостевого списка: набор `<li>` с карточками. */
export function parseLinkedinCards(
  html: string,
  observedAt: string,
): UnifiedVacancy[] {
  const cards = html.split('<li>').slice(1);
  const out: UnifiedVacancy[] = [];
  for (const card of cards) {
    const id = attr(card, 'data-entity-urn').replace('urn:li:jobPosting:', '');
    if (!/^\d+$/.test(id)) continue;
    const title = tagText(card, 'sr-only') || tagText(card, 'base-search-card__title');
    const company = tagText(card, 'hidden-nested-link') || tagText(card, 'base-search-card__subtitle');
    const location = tagText(card, 'job-search-card__location');
    const datetime = attr(card, 'datetime');
    out.push(
      buildJsonVacancy({
        sourceId: LINKEDIN_SOURCE_ID,
        context: { observedAt, sourceName: 'LinkedIn', sourceUrl: `https://www.linkedin.com/jobs/view/${id}` },
        externalId: id,
        title,
        company,
        location: location || undefined,
        isRemote: /remote/i.test(location),
        description: [title, company, location].filter(Boolean).join(' — '),
        skills: [],
        url: `https://www.linkedin.com/jobs/view/${id}`,
        publishedAt: datetime ? fromIso(datetime) : observedAt,
      }),
    );
  }
  return out;
}

export interface LinkedinFetchDeps {
  readonly fetchPage: (url: string, headers: Record<string, string>) => Promise<{ status: number; body: string }>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly observedAt: string;
}

export async function fetchLinkedinGuest(deps: LinkedinFetchDeps): Promise<SourceReading> {
  const vacancies: UnifiedVacancy[] = [];
  let partial = false;
  for (let page = 0; page < LINKEDIN_PAGES_PER_SYNC; page += 1) {
    // Джиттер: LinkedIn быстро отдаёт 429 ровному такту (B218 security-review).
    if (page > 0) await deps.sleep(1_200 + Math.floor(Math.random() * 800));
    const { status, body } = await deps.fetchPage(linkedinGuestUrl(page * LINKEDIN_PAGE), { ...LINKEDIN_HEADERS });
    // 429 — площадка просит остановиться. Первая страница обязана прочитаться:
    // отказ на ней — отказ площадки, а не пустой успех (B199).
    if (status === 429) {
      if (page === 0) throw new Error('vacancy_source_unreachable: 429');
      partial = true;
      break;
    }
    if (status < 200 || status >= 400) {
      if (page === 0) throw new Error(`vacancy_source_unreachable: ${status}`);
      partial = true;
      break;
    }
    const parsed = parseLinkedinCards(body, deps.observedAt);
    if (parsed.length === 0) break;
    vacancies.push(...parsed);
  }
  return { vacancies: vacancies.filter(isUsableVacancy), partial };
}
