import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { buildJsonVacancy, fromIso } from './jsonVacancyRecord';
import { withRequestTimeout } from './requestTimeout';
import { fetchWithStealthFallback } from './jobspyAdapters';

const CORPORATE_FETCH_TIMEOUT_MS = 25_000;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': USER_AGENT,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
  'Cache-Control': 'no-cache',
  Pragma: 'no-cache',
};

function cleanText(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveUrl(relativeOrAbsolute: string, baseUrl: string): string {
  try {
    return new URL(relativeOrAbsolute, baseUrl).toString();
  } catch {
    return relativeOrAbsolute;
  }
}

const IGNORE_TITLE_REGEX =
  /^(apply|apply now|read more|view job|view vacancy|details|see more|learn more|click here|all jobs|back to jobs|job details|careers|jobs|vacancies|our vacancies|open positions|explore jobs|join us|work with us|filter|search|submit|next|previous)$/i;

interface ExtractedRawJob {
  readonly externalId: string;
  readonly title: string;
  readonly url: string;
  readonly location?: string;
  readonly isRemote?: boolean;
  readonly description?: string;
  readonly publishedAt?: string;
}

/**
 * Стратегия 1: разбор Schema.org / JSON-LD JobPosting (Google Jobs standard).
 */
export function extractJsonLdJobs(html: string, baseUrl: string): ExtractedRawJob[] {
  const jobs: ExtractedRawJob[] = [];
  const scriptRegex =
    /<script\b[^>]*type=[\'\"]application\/ld\+json[\'\"][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = scriptRegex.exec(html)) !== null) {
    const content = match[1]?.trim();
    if (!content) continue;

    try {
      const parsed = JSON.parse(content);
      const items = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed['@graph'])
          ? parsed['@graph']
          : [parsed];

      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const type = String(item['@type'] || '');
        if (!/JobPosting/i.test(type)) continue;

        const title = cleanText(String(item.title || ''));
        if (!title || IGNORE_TITLE_REGEX.test(title)) continue;

        const url = String(item.url || item.sameAs || baseUrl);
        const resolved = resolveUrl(url, baseUrl);

        let location = '';
        if (typeof item.jobLocation === 'object' && item.jobLocation !== null) {
          const loc = item.jobLocation as Record<string, unknown>;
          const address = (loc.address || {}) as Record<string, unknown>;
          const parts = [
            address.addressLocality,
            address.addressRegion,
            address.addressCountry,
          ]
            .map((p) => (typeof p === 'string' ? p : ''))
            .filter(Boolean);
          location = parts.join(', ');
        } else if (typeof item.jobLocation === 'string') {
          location = item.jobLocation;
        }

        const isRemote =
          /remote/i.test(location) ||
          /remote/i.test(title) ||
          /telecommute/i.test(String(item.jobLocationType || ''));

        const desc = cleanText(String(item.description || title));
        const extId =
          String(item.identifier?.value || item.identifier || '') ||
          resolved.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-40);

        jobs.push({
          externalId: extId,
          title,
          url: resolved,
          location: location || undefined,
          isRemote,
          description: desc,
          publishedAt: item.datePosted ? String(item.datePosted) : undefined,
        });
      }
    } catch {
      // Игнорируем невалидный JSON
    }
  }

  return jobs;
}

/**
 * Стратегия 2: разбор Next.js __NEXT_DATA__
 */
export function extractNextDataJobs(html: string, baseUrl: string): ExtractedRawJob[] {
  const match = /<script\b[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!match?.[1]) return [];

  try {
    const data = JSON.parse(match[1]);
    const props = data?.props?.pageProps;
    if (!props || typeof props !== 'object') return [];

    const jobs: ExtractedRawJob[] = [];
    const searchInObject = (obj: unknown, depth = 0) => {
      if (depth > 8 || !obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        for (const item of obj) {
          if (item && typeof item === 'object') {
            const rec = item as Record<string, unknown>;
            const maybeTitle = String(rec.title || rec.name || rec.jobTitle || '');
            const maybeSlug = String(rec.slug || rec.url || rec.link || rec.id || '');
            if (maybeTitle && (maybeSlug || rec.id) && !IGNORE_TITLE_REGEX.test(maybeTitle)) {
              let fullUrl = maybeSlug;
              if (!fullUrl.startsWith('http')) {
                fullUrl = resolveUrl(maybeSlug.startsWith('/') ? maybeSlug : `/jobs/${maybeSlug}`, baseUrl);
              }
              const loc = String(rec.location || rec.city || rec.locationName || '');
              jobs.push({
                externalId: String(rec.id || rec.slug || fullUrl.slice(-32)),
                title: cleanText(maybeTitle),
                url: fullUrl,
                location: loc || undefined,
                isRemote: /remote/i.test(loc) || /remote/i.test(maybeTitle),
                description: cleanText(String(rec.description || maybeTitle)),
              });
            }
          }
        }
      } else {
        for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
          if (/jobs|vacancies|openings|positions|dataMap|data|items/i.test(key)) {
            searchInObject(val, depth + 1);
          }
        }
      }
    };

    searchInObject(props);
    return jobs;
  } catch {
    return [];
  }
}

/**
 * Стратегия 3: Семантический разбор ссылок на вакансии в HTML
 */
export function extractSemanticHtmlJobs(html: string, baseUrl: string): ExtractedRawJob[] {
  const jobs: ExtractedRawJob[] = [];
  const seenUrls = new Set<string>();

  // Ищем теги <a ... href=".../job/...">Заголовок</a>
  const linkRegex =
    /<a\b([^>]*href=[\'\"]([^\"\']*(?:\/job\/|\/jobs\/|\/vacancy\/|\/vacancies\/|\/position\/|\/positions\/|\/opening\/|\/openings\/)[^\"\']*)[\'\"][^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[2];
    const innerHtml = match[3];
    if (!href || !innerHtml) continue;

    const fullUrl = resolveUrl(href, baseUrl);
    if (seenUrls.has(fullUrl)) continue;

    if (
      /glassdoor\.com|indeed\.com|linkedin\.com|hh\.ru|superjob\.ru|habr\.com/i.test(fullUrl)
    ) {
      continue;
    }

    // Извлекаем чистый текст заголовка
    let title = cleanText(innerHtml);

    // Если внутри был тег h1-h5 или p/span с заголовком
    const headingMatch = innerHtml.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (headingMatch?.[1]) {
      title = cleanText(headingMatch[1]);
    }

    if (!title || title.length < 3 || title.length > 120 || IGNORE_TITLE_REGEX.test(title)) {
      continue;
    }

    seenUrls.add(fullUrl);
    const extId = fullUrl.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-40);

    jobs.push({
      externalId: extId,
      title,
      url: fullUrl,
      isRemote: /remote/i.test(title),
      description: title,
    });
  }

  return jobs;
}

/**
 * Стратегия 4: Обнаружение встроенных ATS (Workday, Greenhouse, Ashby, Lever) в коде страницы
 */
export function detectEmbeddedAts(html: string): {
  readonly provider: 'greenhouse' | 'lever' | 'ashby' | 'workday';
  readonly endpointUrl: string;
} | null {
  // Workday
  const workdayMatch = html.match(
    /https?:\/\/([a-z0-9_-]+\.wd\d+\.myworkdayjobs\.com)\/([a-z0-9_-]+)/i,
  );
  if (workdayMatch) {
    const host = workdayMatch[1];
    const site = workdayMatch[2];
    const tenant = host.split('.')[0];
    return {
      provider: 'workday',
      endpointUrl: `https://${host}/wday/cxs/${tenant}/${site}/jobs`,
    };
  }

  // Greenhouse
  const ghMatch = html.match(
    /(?:boards\.greenhouse\.io|job-boards\.greenhouse\.io)\/([a-z0-9_-]+)/i,
  );
  if (ghMatch?.[1] && !/embed|api|v1/i.test(ghMatch[1])) {
    return {
      provider: 'greenhouse',
      endpointUrl: `https://boards-api.greenhouse.io/v1/boards/${ghMatch[1]}/jobs`,
    };
  }

  // Ashby
  const ashbyMatch = html.match(/jobs\.ashbyhq\.com\/([a-z0-9_.-]+)/i);
  if (ashbyMatch?.[1]) {
    return {
      provider: 'ashby',
      endpointUrl: `https://api.ashbyhq.com/posting-api/job-board/${ashbyMatch[1]}`,
    };
  }

  // Lever
  const leverMatch = html.match(/jobs\.lever\.co\/([a-z0-9_-]+)/i);
  if (leverMatch?.[1]) {
    return {
      provider: 'lever',
      endpointUrl: `https://api.lever.co/v0/postings/${leverMatch[1]}`,
    };
  }

  return null;
}

/**
 * Универсальный коннектор к корпоративным сайтам (Generic Corporate Site Adapter).
 * Автоматически парсит вакансии с любого корпоративного сайта через 4 каскадные стратегии.
 */
export async function fetchGenericCorporateVacancies(
  source: VacancySourceConfig,
  fetchStealth?: typeof fetchWithStealthFallback,
): Promise<UnifiedVacancy[]> {
  const targetUrl = source.targetUrl;
  const observedAt = new Date().toISOString();

  let html = '';
  try {
    const res = await withRequestTimeout(CORPORATE_FETCH_TIMEOUT_MS, async (signal) => {
      return fetch(targetUrl, {
        headers: BROWSER_HEADERS,
        signal,
      });
    });

    if (res.ok) {
      html = await res.text();
    } else if (fetchStealth) {
      const stealthRes = await fetchStealth(targetUrl, { headers: BROWSER_HEADERS });
      if (stealthRes.status >= 200 && stealthRes.status < 300) {
        html = stealthRes.body;
      }
    }
  } catch {
    if (fetchStealth) {
      try {
        const stealthRes = await fetchStealth(targetUrl, { headers: BROWSER_HEADERS });
        if (stealthRes.status >= 200 && stealthRes.status < 300) {
          html = stealthRes.body;
        }
      } catch {
        return [];
      }
    }
  }

  if (!html) return [];

  // Стратегия 4: Проверяем, не ведет ли корпоративный сайт на ATS
  const embeddedAts = detectEmbeddedAts(html);
  if (embeddedAts) {
    try {
      if (embeddedAts.provider === 'workday') {
        const wdRes = await fetch(embeddedAts.endpointUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
        });
        if (wdRes.ok) {
          const json = await wdRes.json();
          const postings = json.jobPostings || [];
          if (Array.isArray(postings) && postings.length > 0) {
            return postings.map((job: Record<string, unknown>) => {
              const bullets = Array.isArray(job.bulletFields) ? job.bulletFields : [];
              const extId = String(bullets[0] || job.title || '');
              const title = String(job.title || 'Specialist');
              const relPath = String(job.externalPath || '');
              const jobUrl = embeddedAts.endpointUrl.split('/wday/')[0] + relPath;
              const location = Array.isArray(job.locationsText)
                ? job.locationsText.join(', ')
                : String(job.locationsText || '');

              return buildJsonVacancy({
                sourceId: source.id,
                context: {
                  observedAt,
                  sourceName: `${source.name} (Workday)`,
                  sourceUrl: jobUrl,
                },
                externalId: extId || jobUrl.slice(-32),
                title,
                company: source.name,
                location: location || undefined,
                isRemote: /remote/i.test(location) || /remote/i.test(title),
                description: title,
                skills: [],
                url: jobUrl,
                publishedAt: observedAt,
              });
            });
          }
        }
      } else if (embeddedAts.provider === 'greenhouse') {
        const ghRes = await fetch(embeddedAts.endpointUrl);
        if (ghRes.ok) {
          const json = await ghRes.json();
          const jobs = json.jobs || [];
          if (Array.isArray(jobs) && jobs.length > 0) {
            return jobs.map((job: Record<string, unknown>) => {
              const title = String(job.title || '');
              const extId = String(job.id || '');
              const jobUrl = String(job.absolute_url || '');
              const loc = typeof job.location === 'object' && job.location !== null
                ? String((job.location as Record<string, unknown>).name || '')
                : '';

              return buildJsonVacancy({
                sourceId: source.id,
                context: {
                  observedAt,
                  sourceName: `${source.name} (Greenhouse)`,
                  sourceUrl: jobUrl,
                },
                externalId: extId,
                title,
                company: source.name,
                location: loc || undefined,
                isRemote: /remote/i.test(loc) || /remote/i.test(title),
                description: title,
                skills: [],
                url: jobUrl,
                publishedAt: String(job.updated_at || observedAt),
              });
            });
          }
        }
      }
    } catch {
      // При ошибке ATS переходим к следующим стратегиям разбора HTML
    }
  }

  // Стратегия 1: JSON-LD JobPosting
  const jsonLdJobs = extractJsonLdJobs(html, targetUrl);
  if (jsonLdJobs.length > 0) {
    return jsonLdJobs.map((raw) =>
      buildJsonVacancy({
        sourceId: source.id,
        context: {
          observedAt,
          sourceName: `${source.name} Careers`,
          sourceUrl: raw.url,
        },
        externalId: raw.externalId,
        title: raw.title,
        company: source.name,
        location: raw.location,
        isRemote: raw.isRemote ?? /remote/i.test(raw.location ?? ''),
        description: raw.description || raw.title,
        skills: [],
        url: raw.url,
        publishedAt: raw.publishedAt ? fromIso(raw.publishedAt) : observedAt,
      }),
    );
  }

  // Стратегия 2: Next.js __NEXT_DATA__
  const nextDataJobs = extractNextDataJobs(html, targetUrl);
  if (nextDataJobs.length > 0) {
    return nextDataJobs.map((raw) =>
      buildJsonVacancy({
        sourceId: source.id,
        context: {
          observedAt,
          sourceName: `${source.name} Careers`,
          sourceUrl: raw.url,
        },
        externalId: raw.externalId,
        title: raw.title,
        company: source.name,
        location: raw.location,
        isRemote: raw.isRemote ?? /remote/i.test(raw.location ?? ''),
        description: raw.description || raw.title,
        skills: [],
        url: raw.url,
        publishedAt: raw.publishedAt ? fromIso(raw.publishedAt) : observedAt,
      }),
    );
  }

  // Стратегия 3: Семантические HTML-карточки
  const semanticJobs = extractSemanticHtmlJobs(html, targetUrl);
  if (semanticJobs.length > 0) {
    return semanticJobs.map((raw) =>
      buildJsonVacancy({
        sourceId: source.id,
        context: {
          observedAt,
          sourceName: `${source.name} Careers`,
          sourceUrl: raw.url,
        },
        externalId: raw.externalId,
        title: raw.title,
        company: source.name,
        location: raw.location,
        isRemote: raw.isRemote ?? /remote/i.test(raw.location ?? ''),
        description: raw.description || raw.title,
        skills: [],
        url: raw.url,
        publishedAt: observedAt,
      }),
    );
  }

  return [];
}
