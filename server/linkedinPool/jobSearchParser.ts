/**
 * Разбор списка вакансий LinkedIn (`/jobs/search/`) на сессии пула.
 * Только чтение HTML уже загруженной страницы: никаких кликов и переходов.
 *
 * Разметка проверена на синтетической фикстуре (fixtures/jobs-search-page.html):
 * живая страница в момент написания недоступна. Разбор намеренно терпим к смене
 * классов: карточка определяется по `data-occludable-job-id`, ссылка — по
 * `/jobs/view/<id>`.
 */
export interface LinkedinJobCard {
  readonly jobId: string;
  readonly title: string;
  readonly company: string;
  readonly location: string;
  readonly url: string;
  readonly publishedAt?: string;
}

const FRESH_WINDOW_SECONDS = 7 * 24 * 60 * 60;
const MAX_CARDS_PER_PAGE = 60;
const MAX_FIELD = 300;

export function linkedinJobSearchUrl(keywords: string, location: string): string {
  const url = new URL('https://www.linkedin.com/jobs/search/');
  url.searchParams.set('keywords', keywords);
  url.searchParams.set('location', location);
  url.searchParams.set('f_TPR', `r${FRESH_WINDOW_SECONDS}`);
  return url.toString();
}

function decode(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FIELD);
}

function classText(card: string, className: string): string {
  const match = new RegExp(
    `class="[^"]*${className}[^"]*"[^>]*>([\\s\\S]*?)</(?:a|div|ul)>`,
    'i',
  ).exec(card);
  return match ? decode(match[1]!) : '';
}

export function parseLinkedinJobSearchPageHtml(html: string): LinkedinJobCard[] {
  const chunks = html.split(/<(?:li|div)\b[^>]*(?:data-occludable-job-id|data-job-id)=/i).slice(1);
  const seen = new Set<string>();
  const cards: LinkedinJobCard[] = [];
  for (const chunk of chunks) {
    const jobId =
      /^"(\d{5,20})"/.exec(chunk)?.[1] ||
      /data-(?:occludable-)?job-id=["'](\d{5,20})["']/i.exec(chunk)?.[1] ||
      /\/jobs\/view\/(\d{5,20})/i.exec(chunk)?.[1];
    if (!jobId || seen.has(jobId)) continue;
    const title =
      classText(chunk, 'job-card-container__link') ||
      classText(chunk, 'job-card-list__title') ||
      classText(chunk, 'base-search-card__title');
    if (!title) continue;
    seen.add(jobId);
    const published = /<time[^>]*datetime="([^"]+)"/i.exec(chunk)?.[1];
    cards.push({
      jobId,
      title,
      company:
        classText(chunk, 'artdeco-entity-lockup__subtitle') ||
        classText(chunk, 'job-card-container__primary-description') ||
        classText(chunk, 'base-search-card__subtitle'),
      location:
        classText(chunk, 'job-card-container__metadata-wrapper') ||
        classText(chunk, 'job-card-container__metadata-item') ||
        classText(chunk, 'job-search-card__location'),
      url: `https://www.linkedin.com/jobs/view/${jobId}`,
      ...(published ? { publishedAt: published.slice(0, 40) } : {}),
    });
    if (cards.length >= MAX_CARDS_PER_PAGE) break;
  }
  return cards;
}
