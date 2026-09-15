import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import type { SourceReading } from './multiSourceVacancyEngine';
import { buildJsonVacancy, fromIso, isUsableVacancy } from './jsonVacancyRecord';
import { LINKEDIN_GUEST_URL } from './jobspyEndpoints';
import { FAN_SIZE, type FanCombo, fanComboAt, fanStartIndex } from './jobspyFan';

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
  ) => Promise<{ status: number; body: string }>;
  readonly sleep: (ms: number) => Promise<void>;
  readonly observedAt: string;
}

export async function fetchLinkedinGuest(
  deps: LinkedinFetchDeps,
  nowMs: number = Date.now(),
): Promise<SourceReading> {
  const startIndex = fanStartIndex(nowMs, LINKEDIN_INTERVAL_MINUTES, LINKEDIN_COMBOS_PER_SYNC);
  const vacancies: UnifiedVacancy[] = [];
  // Веер шире одного опроса, поэтому чтение частичное: движок дополняет срез,
  // а не заменяет его — иначе каждый опрос стирал бы прошлые комбинации.
  let partial = true;
  let requests = 0;

  for (let step = 0; step < LINKEDIN_COMBOS_PER_SYNC; step += 1) {
    const combo = fanComboAt(startIndex + step);
    for (let page = 0; page < LINKEDIN_PAGES_PER_COMBO; page += 1) {
      const start = page * LINKEDIN_PAGE;
      // Джиттер: LinkedIn быстро отдаёт 429 ровному такту (B218 security-review).
      if (requests > 0) await deps.sleep(600 + Math.floor(Math.random() * 600));
      requests += 1;
      const { status, body } = await deps.fetchPage(linkedinGuestUrl(start, combo), {
        ...LINKEDIN_HEADERS,
      });
      // 429 — площадка просит остановиться, и мы останавливаемся совсем.
      // Первая страница обязана прочитаться: отказ на ней — отказ площадки,
      // а не пустой успех (B199).
      if (status === 429) {
        if (requests === 1) throw new Error('vacancy_source_unreachable: 429');
        return { vacancies: vacancies.filter(isUsableVacancy), partial: true };
      }
      if (status < 200 || status >= 400) {
        if (requests === 1) throw new Error(`vacancy_source_unreachable: ${status}`);
        return { vacancies: vacancies.filter(isUsableVacancy), partial: true };
      }
      const parsed = parseLinkedinCards(body, deps.observedAt);
      // Комбинация исчерпана — к следующей, не добивая её потолок впустую.
      if (parsed.length === 0) break;
      vacancies.push(...parsed);
    }
  }

  // Полный круг веера за один опрос — чтение полное.
  if (LINKEDIN_COMBOS_PER_SYNC >= FAN_SIZE) partial = false;
  return { vacancies: vacancies.filter(isUsableVacancy), partial };
}
