import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import type { SourceReading } from './multiSourceVacancyEngine';
import { buildJsonVacancy, fromIso, isUsableVacancy } from './jsonVacancyRecord';
import { LINKEDIN_GUEST_URL } from './jobspyEndpoints';
import {
  type FanCombo,
  currentFanDemand,
  fanComboAt,
  fanCombosForSync,
} from './jobspyFan';
import {
  linkedinProviderCapability,
  type LinkedinProviderCapabilityVerdict,
} from '../crawler/linkedinProviderCapability';

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

/**
 * Один запрос отдаёт не больше 550 карточек: `start=550` уже пуст (замер с
 * прод-VM 2026-09-14, 56 запросов подряд без единого 429). Поэтому охват даёт
 * веер «роль × город», а не более глубокое чтение одного запроса; окно
 * комбинаций сдвигается по кругу от времени, и за сутки веер проходится
 * целиком.
 */
const LINKEDIN_PAGE = 10;
const LINKEDIN_COMBOS_PER_SYNC = 20;
const LINKEDIN_PAGES_PER_COMBO = 8;
const LINKEDIN_INTERVAL_MINUTES = 90;
export const LINKEDIN_PAGES_PER_SYNC = LINKEDIN_COMBOS_PER_SYNC * LINKEDIN_PAGES_PER_COMBO;

/**
 * Окно свежести выдачи, секунды. `f_TPR=r604800` — «размещено за неделю»:
 * площадка тогда отдаёт только свежие карточки (замер: без фильтра выдача
 * уходит на две недели назад, с фильтром — 4 дня). Пул держит тридцать дней,
 * и круг веера примерно недельный, поэтому недельное окно закрывает рынок без
 * разрывов и не тратит страницы на то, что уже прочитано.
 */
const LINKEDIN_FRESH_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const LINKEDIN_HEADERS = {
  accept: 'text/html,application/xhtml+xml',
  'accept-language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
} as const;

export function linkedinGuestUrl(start: number, combo: FanCombo = fanComboAt(0)): string {
  const url = new URL(LINKEDIN_GUEST_URL);
  url.searchParams.set('keywords', combo.term);
  url.searchParams.set('location', combo.target.location);
  url.searchParams.set('f_TPR', `r${LINKEDIN_FRESH_WINDOW_SECONDS}`);
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
export function parseLinkedinCards(html: string, observedAt: string): UnifiedVacancy[] {
  const cards = html.split('<li>').slice(1);
  const out: UnifiedVacancy[] = [];
  for (const card of cards) {
    const id = attr(card, 'data-entity-urn').replace('urn:li:jobPosting:', '');
    if (!/^\d+$/.test(id)) continue;
    const title = tagText(card, 'sr-only') || tagText(card, 'base-search-card__title');
    const company =
      tagText(card, 'hidden-nested-link') || tagText(card, 'base-search-card__subtitle');
    const location = tagText(card, 'job-search-card__location');
    const datetime = attr(card, 'datetime');
    out.push(
      buildJsonVacancy({
        sourceId: LINKEDIN_SOURCE_ID,
        context: {
          observedAt,
          sourceName: 'LinkedIn',
          sourceUrl: `https://www.linkedin.com/jobs/view/${id}`,
        },
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
  readonly fetchPage: (
    url: string,
    headers: Record<string, string>,
  ) => Promise<{ status: number; body: string; retryAfterSeconds?: number }>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly observedAt: string;
  /** Test/provider adapter must opt in explicitly; the default is fail-closed. */
  readonly providerCapability?: LinkedinProviderCapabilityVerdict;
  /** Роли спроса; без них — то, что подключил обслуживатель пула. */
  readonly demandTerms?: readonly string[];
  /** Wall-clock budget of one run, ms; the run ends successfully when spent. */
  readonly budgetMs?: number;
  readonly clock?: () => number;
}

/** Pause between requests: at least 0.4 s plus jitter (flat cadence draws 429). */
export const LINKEDIN_MIN_PAUSE_MS = 400;
export const LINKEDIN_PAUSE_JITTER_MS = 600;
/** 429: retries per request, base pause doubles each time, capped. */
const LINKEDIN_429_RETRIES = 2;
const LINKEDIN_429_BASE_MS = 5_000;
const LINKEDIN_429_MAX_MS = 120_000;

/** UAE is read on every sync (owner 2026-11-03): three emirates and the country. */
export const UAE_LOCATIONS = ['Dubai', 'Abu Dhabi', 'Sharjah', 'United Arab Emirates'] as const;
const UAE_COMBOS_PER_SYNC = UAE_LOCATIONS.length;

function uaeCombos(
  nowMs: number,
  terms: readonly string[],
): FanCombo[] {
  const tick = Math.floor(nowMs / (LINKEDIN_INTERVAL_MINUTES * 60_000));
  const roles = terms.length > 0 ? terms : ['software engineer'];
  return UAE_LOCATIONS.map((location, step) => ({
    term: roles[(tick * UAE_COMBOS_PER_SYNC + step) % roles.length]!,
    target: { region: 'mena', indeedCountry: 'AE', location },
  }));
}

function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  const exponential = LINKEDIN_429_BASE_MS * 2 ** attempt;
  const asked = retryAfterSeconds && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0;
  return Math.min(Math.max(exponential, asked), LINKEDIN_429_MAX_MS);
}

type GuestResponse = Awaited<ReturnType<LinkedinFetchDeps['fetchPage']>>;

/**
 * 429 — the platform asks to slow down: pause by Retry-After or exponentially,
 * retry; if it persists the caller stops. The first request is never retried.
 */
async function fetchWithBackoff(
  deps: LinkedinFetchDeps,
  url: string,
  mayRetry: boolean,
): Promise<GuestResponse> {
  let response = await deps.fetchPage(url, { ...LINKEDIN_HEADERS });
  for (let attempt = 0; mayRetry && attempt < LINKEDIN_429_RETRIES; attempt += 1) {
    if (response.status !== 429) break;
    await deps.sleep(backoffMs(attempt, response.retryAfterSeconds));
    response = await deps.fetchPage(url, { ...LINKEDIN_HEADERS });
  }
  return response;
}

/** Candidate roles first, then the fan window (27.10), then the UAE block. */
function syncCombos(nowMs: number, demand: readonly string[]): FanCombo[] {
  return [
    ...fanCombosForSync(
      nowMs,
      LINKEDIN_INTERVAL_MINUTES,
      LINKEDIN_COMBOS_PER_SYNC - UAE_COMBOS_PER_SYNC,
      demand,
    ),
    ...uaeCombos(
      nowMs,
      demand.filter((term) => /^[a-z0-9&+.,'\s-]+$/u.test(term)),
    ),
  ];
}

/** One run may spend this long reading; the rest of the fan waits for the next run. */
export const LINKEDIN_BUDGET_MS = 150_000;

/**
 * Where the last run stopped inside the current fan window. Kept in memory: a
 * restart only costs one repeated page range, and no schema change is needed.
 */
interface FanCursor {
  readonly tick: number;
  readonly combo: number;
  readonly page: number;
}
let fanCursor: FanCursor | null = null;

/** Test hook: forget where the previous run stopped. */
export function resetLinkedinFanCursor(): void {
  fanCursor = null;
}

function resumePoint(tick: number): { combo: number; page: number } {
  return fanCursor && fanCursor.tick === tick
    ? { combo: fanCursor.combo, page: fanCursor.page }
    : { combo: 0, page: 0 };
}

type PageOutcome = 'cards' | 'exhausted' | 'stop';

async function readPage(
  deps: LinkedinFetchDeps,
  url: string,
  firstRequest: boolean,
  into: UnifiedVacancy[],
): Promise<PageOutcome> {
  let response: GuestResponse;
  try {
    response = await fetchWithBackoff(deps, url, !firstRequest);
  } catch (error) {
    // A page that timed out costs that page, not the pages already read.
    if (firstRequest) throw error;
    return 'stop';
  }
  const { status, body } = response;
  if (status === 429 || status < 200 || status >= 400) {
    if (firstRequest) throw new Error(`vacancy_source_unreachable: ${status}`);
    return 'stop';
  }
  const parsed = parseLinkedinCards(body, deps.observedAt);
  if (parsed.length === 0) return 'exhausted';
  into.push(...parsed);
  return 'cards';
}

export async function fetchLinkedinGuest(
  deps: LinkedinFetchDeps,
  nowMs: number = Date.now(),
): Promise<SourceReading> {
  const capability = deps.providerCapability ?? linkedinProviderCapability().verdict;
  if (capability === 'not_configured') {
    return { vacancies: [], partial: true };
  }
  const combos = syncCombos(nowMs, deps.demandTerms ?? currentFanDemand());
  const clock = deps.clock ?? Date.now;
  const budgetMs = deps.budgetMs ?? LINKEDIN_BUDGET_MS;
  const startedAt = clock();
  const tick = Math.floor(nowMs / (LINKEDIN_INTERVAL_MINUTES * 60_000));
  const resume = resumePoint(tick);
  const vacancies: UnifiedVacancy[] = [];
  let requests = 0;
  let stoppedAt: FanCursor | null = null;

  scan: for (let c = resume.combo; c < combos.length; c += 1) {
    for (let page = c === resume.combo ? resume.page : 0; page < LINKEDIN_PAGES_PER_COMBO; page += 1) {
      if (requests > 0 && clock() - startedAt >= budgetMs) {
        stoppedAt = { tick, combo: c, page };
        break scan;
      }
      // Джиттер: LinkedIn быстро отдаёт 429 ровному такту (B218 security-review).
      if (requests > 0) {
        await deps.sleep(
          LINKEDIN_MIN_PAUSE_MS + Math.floor(Math.random() * LINKEDIN_PAUSE_JITTER_MS),
        );
      }
      requests += 1;
      const url = linkedinGuestUrl(page * LINKEDIN_PAGE, combos[c]!);
      const outcome = await readPage(deps, url, requests === 1, vacancies);
      if (outcome === 'stop') {
        // Resume after the page that failed, so a stuck page cannot pin the fan.
        stoppedAt = { tick, combo: c, page: page + 1 };
        break scan;
      }
      if (outcome === 'exhausted') break;
    }
  }

  // A run that reached the end of the window starts the next one from the top.
  fanCursor = stoppedAt;
  // Веер шире одного опроса, поэтому чтение всегда частичное: движок дополняет
  // срез, а не заменяет его — иначе каждый опрос стирал бы прошлые комбинации.
  return { vacancies: vacancies.filter(isUsableVacancy), partial: true };
}
