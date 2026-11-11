import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import { buildJsonVacancy, fromIso, fromLooseDate } from './jsonVacancyRecord';
import { parseDouCompanyVacanciesHtml } from './douVacanciesAdapter';
import { withRequestTimeout } from './requestTimeout';
import { fetchWithStealthFallback } from './jobspyAdapters';
import {
  IGNORE_TITLE_REGEX,
  cleanDescription,
  cleanText,
  extractComeetJobs,
  extractTildaCardJobs,
  resolveUrl,
  type ExtractedRawJob,
} from './corporateHtmlWidgets';
import { corporateQualityError, gateCorporateVacancies } from './corporateSourceQuality';
import { hasScriptPageSigns } from './scriptPageSigns';
import type { RenderScriptPage } from './scriptPageRenderer';

const CORPORATE_FETCH_TIMEOUT_MS = 15_000;

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
  'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8',
  'Cache-Control': 'no-cache',
};

function extractStringValue(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return String(obj.rendered || obj.en || obj.name || obj.title || obj.text || '');
  }
  return String(val);
}

function parseJsonLdLocation(jobLocation: unknown): string {
  if (typeof jobLocation === 'object' && jobLocation !== null) {
    const loc = jobLocation as Record<string, unknown>;
    const address = (loc.address || {}) as Record<string, unknown>;
    return [address.addressLocality, address.addressRegion, address.addressCountry]
      .map((p) => (typeof p === 'string' ? p : ''))
      .filter(Boolean)
      .join(', ');
  }
  return typeof jobLocation === 'string' ? jobLocation : '';
}

function parseJsonLdJobItem(
  item: Record<string, unknown>,
  baseUrl: string,
): ExtractedRawJob | null {
  const type = String(item['@type'] || '');
  if (!/JobPosting/i.test(type)) return null;

  const title = cleanText(String(item.title || ''));
  if (!title || IGNORE_TITLE_REGEX.test(title)) return null;

  const url = String(item.url || item.sameAs || baseUrl);
  const resolved = resolveUrl(url, baseUrl);
  const location = parseJsonLdLocation(item.jobLocation);
  const isRemote =
    /remote/i.test(location) ||
    /remote/i.test(title) ||
    /telecommute/i.test(String(item.jobLocationType || ''));

  const desc = cleanDescription(String(item.description || title));
  const ident = item.identifier;
  const identValue =
    typeof ident === 'object' && ident !== null
      ? String((ident as Record<string, unknown>).value || '')
      : typeof ident === 'string'
        ? ident
        : '';
  const extId = identValue || resolved.replace(/[^a-zA-Z0-9_-]/g, '_').slice(-40);

  return {
    externalId: extId,
    title,
    url: resolved,
    location: location || undefined,
    isRemote,
    description: desc,
    publishedAt: item.datePosted ? String(item.datePosted) : undefined,
  };
}

/**
 * Стратегия 1: разбор Schema.org / JSON-LD JobPosting (Google Jobs standard).
 */
export function extractJsonLdJobs(html: string, baseUrl: string): ExtractedRawJob[] {
  const jobs: ExtractedRawJob[] = [];
  const scriptRegex =
    /<script\b[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi;
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
        const job = parseJsonLdJobItem(item as Record<string, unknown>, baseUrl);
        if (job) jobs.push(job);
      }
    } catch {
      // Игнорируем невалидный JSON
    }
  }

  return jobs;
}

function parseNextDataItem(item: unknown, baseUrl: string): ExtractedRawJob | null {
  if (!item || typeof item !== 'object') return null;
  const rec = item as Record<string, unknown>;
  const rawTitle = extractStringValue(rec.title || rec.name || rec.jobTitle || '');
  const maybeTitle = cleanText(rawTitle);
  const maybeSlug = String(rec.slug || rec.url || rec.link || rec.id || '');
  if (
    !maybeTitle ||
    maybeTitle.includes('[object Object]') ||
    (!maybeSlug && !rec.id) ||
    IGNORE_TITLE_REGEX.test(maybeTitle)
  ) {
    return null;
  }
  const fullUrl = maybeSlug.startsWith('http')
    ? maybeSlug
    : resolveUrl(maybeSlug.startsWith('/') ? maybeSlug : `/jobs/${maybeSlug}`, baseUrl);
  const loc = String(rec.location || rec.city || rec.locationName || '');
  return {
    externalId: String(rec.id || rec.slug || fullUrl.slice(-32)),
    title: cleanText(maybeTitle),
    url: fullUrl,
    location: loc || undefined,
    isRemote: /remote/i.test(loc) || /remote/i.test(maybeTitle),
    description: cleanDescription(String(rec.description || rec.content || maybeTitle)),
  };
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
          const job = parseNextDataItem(item, baseUrl);
          if (job) jobs.push(job);
        }
        return;
      }
      for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
        if (/jobs|vacancies|openings|positions|dataMap|data|items/i.test(key)) {
          searchInObject(val, depth + 1);
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

  const linkRegex =
    /<a\b([^>]*href=['"]([^"']*(?:\/job\/|\/jobs\/|\/vacancy\/|\/vacancies\/|\/position\/|\/positions\/|\/opening\/|\/openings\/)[^"']*)['"][^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = match[2];
    const innerHtml = match[3];
    if (!href || !innerHtml) continue;

    const fullUrl = resolveUrl(href, baseUrl);
    if (seenUrls.has(fullUrl)) continue;

    if (/glassdoor\.com|indeed\.com|linkedin\.com|hh\.ru|superjob\.ru|habr\.com/i.test(fullUrl)) {
      continue;
    }

    let title = cleanText(innerHtml);
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

  if (jobs.length === 0) {
    const comeet = extractComeetJobs(html, baseUrl);
    if (comeet.length > 0) return comeet;
    const tilda = extractTildaCardJobs(html, baseUrl);
    if (tilda.length > 0) return tilda;
  }

  return jobs;
}

export {
  detectEmbeddedAts,
  type DetectedAts,
  type DetectedAtsProvider,
} from './embeddedAtsDetector';
import { detectEmbeddedAts, type DetectedAts } from './embeddedAtsDetector';
import { fetchEmbeddedAtsBoard } from './embeddedAtsBoardFetch';

async function fetchWorkdayAts(
  ats: DetectedAts,
  source: VacancySourceConfig,
  observedAt: string,
): Promise<UnifiedVacancy[]> {
  const wdRes = await fetch(ats.endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ appliedFacets: {}, limit: 20, offset: 0, searchText: '' }),
  });
  if (!wdRes.ok) return [];
  const json = await wdRes.json();
  const postings = json.jobPostings || [];
  if (!Array.isArray(postings) || postings.length === 0) return [];
  return postings.map((job: Record<string, unknown>) => {
    const bullets = Array.isArray(job.bulletFields) ? job.bulletFields : [];
    const extId = String(bullets[0] || job.title || '');
    const title = String(job.title || 'Specialist');
    const relPath = String(job.externalPath || '');
    const jobUrl = ats.endpointUrl.split('/wday/')[0] + relPath;
    const location = Array.isArray(job.locationsText)
      ? job.locationsText.join(', ')
      : String(job.locationsText || '');

    return buildJsonVacancy({
      sourceId: source.id,
      context: { observedAt, sourceName: `${source.name} (Workday)`, sourceUrl: jobUrl },
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

async function fetchGreenhouseAts(
  ats: DetectedAts,
  source: VacancySourceConfig,
  observedAt: string,
): Promise<UnifiedVacancy[]> {
  const ghUrl = ats.endpointUrl.includes('?') ? ats.endpointUrl : `${ats.endpointUrl}?content=true`;
  const ghRes = await fetch(ghUrl);
  if (!ghRes.ok) return [];
  const json = await ghRes.json();
  const jobs = json.jobs || [];
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  return jobs.map((job: Record<string, unknown>) => {
    const title = cleanText(String(job.title || ''));
    const extId = String(job.id || '');
    const jobUrl = String(job.absolute_url || '');
    const loc =
      typeof job.location === 'object' && job.location !== null
        ? String((job.location as Record<string, unknown>).name || '')
        : '';
    const desc = cleanDescription(String(job.content || title));

    return buildJsonVacancy({
      sourceId: source.id,
      context: { observedAt, sourceName: `${source.name} (Greenhouse)`, sourceUrl: jobUrl },
      externalId: extId,
      title,
      company: source.name,
      location: loc || undefined,
      isRemote: /remote/i.test(loc) || /remote/i.test(title),
      description: desc,
      skills: [],
      url: jobUrl,
      publishedAt: String(job.updated_at || observedAt),
    });
  });
}

async function fetchAshbyAts(
  ats: DetectedAts,
  source: VacancySourceConfig,
  observedAt: string,
): Promise<UnifiedVacancy[]> {
  const ashbyRes = await fetch(ats.endpointUrl);
  if (!ashbyRes.ok) return [];
  const json = await ashbyRes.json();
  const jobs = json.jobs || [];
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  return jobs.map((job: Record<string, unknown>) => {
    const title = cleanText(String(job.title || ''));
    const extId = String(job.id || '');
    const jobUrl = String(job.jobUrl || job.applyUrl || `${source.targetUrl}#${extId}`);
    const loc = String(job.location || '');
    const isRemote = Boolean(job.isRemote) || /remote/i.test(loc) || /remote/i.test(title);
    const desc = cleanDescription(String(job.descriptionPlain || job.descriptionHtml || title));

    return buildJsonVacancy({
      sourceId: source.id,
      context: { observedAt, sourceName: `${source.name} (Ashby)`, sourceUrl: jobUrl },
      externalId: extId,
      title,
      company: source.name,
      location: loc || undefined,
      isRemote,
      description: desc,
      skills: [],
      url: jobUrl,
      publishedAt: String(job.publishedAt || observedAt),
    });
  });
}

async function fetchLeverAts(
  ats: DetectedAts,
  source: VacancySourceConfig,
  observedAt: string,
): Promise<UnifiedVacancy[]> {
  const leverRes = await fetch(ats.endpointUrl);
  if (!leverRes.ok) return [];
  const jobs = await leverRes.json();
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  return jobs.map((job: Record<string, unknown>) => {
    const title = cleanText(String(job.text || ''));
    const extId = String(job.id || '');
    const jobUrl = String(job.hostedUrl || job.applyUrl || `${source.targetUrl}#${extId}`);
    const cats =
      job.categories && typeof job.categories === 'object'
        ? (job.categories as Record<string, unknown>)
        : {};
    const loc = String(cats.location || '');
    const isRemote = /remote/i.test(loc) || /remote/i.test(title);
    const descBody = String(job.descriptionPlain || job.description || '');
    const lists = Array.isArray(job.lists)
      ? job.lists
          .map(
            (l: Record<string, unknown>) =>
              `${cleanText(String(l.text || ''))}:\n${cleanDescription(String(l.content || ''))}`,
          )
          .join('\n\n')
      : '';
    const fullDesc = [descBody, lists].filter(Boolean).join('\n\n') || title;
    const desc = cleanDescription(fullDesc);

    return buildJsonVacancy({
      sourceId: source.id,
      context: { observedAt, sourceName: `${source.name} (Lever)`, sourceUrl: jobUrl },
      externalId: extId,
      title,
      company: source.name,
      location: loc || undefined,
      isRemote,
      description: desc,
      skills: [],
      url: jobUrl,
      publishedAt: job.createdAt ? fromLooseDate(job.createdAt) : observedAt,
    });
  });
}

async function fetchWorkableAts(
  ats: DetectedAts,
  source: VacancySourceConfig,
  observedAt: string,
): Promise<UnifiedVacancy[]> {
  const workableRes = await fetch(ats.endpointUrl);
  if (!workableRes.ok) return [];
  const json = await workableRes.json();
  const jobs = json.jobs || [];
  if (!Array.isArray(jobs) || jobs.length === 0) return [];
  return jobs.map((job: Record<string, unknown>) => {
    const title = cleanText(String(job.title || ''));
    const extId = String(job.shortcode || job.id || '');
    const jobUrl = String(job.url || job.shortlink || `${source.targetUrl}#${extId}`);
    const loc = [job.city, job.region, job.country].filter(Boolean).join(', ');
    const isRemote = Boolean(job.telecommuting) || /remote/i.test(loc) || /remote/i.test(title);
    const descParts = [job.description, job.requirements, job.benefits].filter(Boolean).map(String);
    const desc = cleanDescription(descParts.join('\n\n') || title);

    return buildJsonVacancy({
      sourceId: source.id,
      context: { observedAt, sourceName: `${source.name} (Workable)`, sourceUrl: jobUrl },
      externalId: extId,
      title,
      company: source.name,
      location: loc || undefined,
      isRemote,
      description: desc,
      skills: [],
      url: jobUrl,
      publishedAt: String(job.published_on || job.created_at || observedAt),
    });
  });
}

async function fetchRecruiteeAts(
  ats: DetectedAts,
  source: VacancySourceConfig,
  observedAt: string,
): Promise<UnifiedVacancy[]> {
  const res = await fetch(ats.endpointUrl);
  if (!res.ok) return [];
  const json = await res.json();
  const offers = json.offers || [];
  if (!Array.isArray(offers) || offers.length === 0) return [];
  return offers.map((job: Record<string, unknown>) => {
    const title = cleanText(String(job.title || ''));
    const extId = String(job.id || job.slug || '');
    const jobUrl = String(
      job.careers_url || job.careers_apply_url || `${source.targetUrl}#${extId}`,
    );
    const loc = String(job.location || job.city || '');
    const isRemote = Boolean(job.remote) || /remote/i.test(loc) || /remote/i.test(title);
    const descParts = [job.description, job.requirements].filter(Boolean).map(String);
    const desc = cleanDescription(descParts.join('\n\n') || title);

    return buildJsonVacancy({
      sourceId: source.id,
      context: { observedAt, sourceName: `${source.name} (Recruitee)`, sourceUrl: jobUrl },
      externalId: extId,
      title,
      company: source.name,
      location: loc || undefined,
      isRemote,
      description: desc,
      skills: [],
      url: jobUrl,
      publishedAt: job.published_at ? fromLooseDate(String(job.published_at)) : observedAt,
    });
  });
}

async function fetchSmartRecruitersDetail(orgId: string, extId: string): Promise<string> {
  try {
    const res = await fetch(
      `https://api.smartrecruiters.com/v1/companies/${orgId}/postings/${extId}`,
    );
    if (!res.ok) return '';
    const json = await res.json();
    const sections =
      json.jobAd && typeof json.jobAd === 'object'
        ? (json.jobAd.sections as Record<string, unknown>)
        : {};
    return ['companyDescription', 'jobDescription', 'qualifications', 'additionalInformation']
      .map((k) => {
        const sec = sections[k] as Record<string, unknown> | undefined;
        if (!sec?.text) return '';
        const body = cleanDescription(String(sec.text));
        const head = cleanText(String(sec.title || ''));
        return head && body ? `${head}\n${body}` : body;
      })
      .filter(Boolean)
      .join('\n\n');
  } catch {
    return '';
  }
}

async function fetchSmartRecruitersAts(
  ats: DetectedAts,
  source: VacancySourceConfig,
  observedAt: string,
): Promise<UnifiedVacancy[]> {
  const srRes = await fetch(ats.endpointUrl);
  if (!srRes.ok) return [];
  const json = await srRes.json();
  const content = json.content || [];
  if (!Array.isArray(content) || content.length === 0) return [];
  const results: UnifiedVacancy[] = [];
  for (const job of content) {
    const title = cleanText(String(job.name || ''));
    const extId = String(job.id || '');
    const jobUrl = `https://jobs.smartrecruiters.com/${ats.orgId}/${extId}`;
    const locObj =
      job.location && typeof job.location === 'object'
        ? (job.location as Record<string, unknown>)
        : {};
    const loc = [locObj.city, locObj.region, locObj.country].filter(Boolean).join(', ');
    const isRemote = Boolean(locObj.remote) || /remote/i.test(loc) || /remote/i.test(title);
    let desc = title;
    if (ats.orgId && extId) {
      const detail = await fetchSmartRecruitersDetail(ats.orgId, extId);
      if (detail) desc = detail;
    }
    results.push(
      buildJsonVacancy({
        sourceId: source.id,
        context: { observedAt, sourceName: `${source.name} (SmartRecruiters)`, sourceUrl: jobUrl },
        externalId: extId,
        title,
        company: source.name,
        location: loc || undefined,
        isRemote,
        description: desc,
        skills: [],
        url: jobUrl,
        publishedAt: String(job.releasedDate || observedAt),
      }),
    );
  }
  return results;
}

async function fetchFromAtsProvider(
  ats: DetectedAts,
  source: VacancySourceConfig,
  observedAt: string,
  html?: string,
): Promise<UnifiedVacancy[]> {
  switch (ats.provider) {
    case 'workday':
      return fetchWorkdayAts(ats, source, observedAt);
    case 'greenhouse':
      return fetchGreenhouseAts(ats, source, observedAt);
    case 'ashby':
      return fetchAshbyAts(ats, source, observedAt);
    case 'lever':
      return fetchLeverAts(ats, source, observedAt);
    case 'workable':
      return fetchWorkableAts(ats, source, observedAt);
    case 'smartrecruiters':
      return fetchSmartRecruitersAts(ats, source, observedAt);
    case 'recruitee':
      return fetchRecruiteeAts(ats, source, observedAt);
    case 'bamboohr':
    case 'teamtailor':
    case 'personio':
    case 'pinpoint':
      return ats.orgId ? fetchEmbeddedAtsBoard(ats.provider, ats.orgId, source, observedAt) : [];
    case 'dou':
      if (html) {
        return parseDouCompanyVacanciesHtml(html, {
          company: source.name,
          companySlug: ats.orgId || 'company',
          sourceUrl: source.targetUrl,
          observedAt,
        });
      }
      return [];
    default:
      return [];
  }
}

async function fetchCorporateHtml(
  targetUrl: string,
  fetchStealth?: typeof fetchWithStealthFallback,
): Promise<string> {
  try {
    const res = await withRequestTimeout(CORPORATE_FETCH_TIMEOUT_MS, async (signal) => {
      return fetch(targetUrl, { headers: BROWSER_HEADERS, signal });
    });
    if (res.ok) return await res.text();
    if (fetchStealth) {
      const stealthRes = await fetchStealth(targetUrl, { headers: BROWSER_HEADERS });
      if (stealthRes.status >= 200 && stealthRes.status < 300) return stealthRes.body;
    }
  } catch {
    if (fetchStealth) {
      try {
        const stealthRes = await fetchStealth(targetUrl, { headers: BROWSER_HEADERS });
        if (stealthRes.status >= 200 && stealthRes.status < 300) return stealthRes.body;
      } catch {
        return '';
      }
    }
  }
  return '';
}

function mapRawJobsToUnified(
  rawJobs: ExtractedRawJob[],
  source: VacancySourceConfig,
  observedAt: string,
): UnifiedVacancy[] {
  return rawJobs.map((raw) =>
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
      description: cleanDescription(raw.description || raw.title),
      skills: [],
      url: raw.url,
      publishedAt: raw.publishedAt ? fromIso(raw.publishedAt) : observedAt,
    }),
  );
}

/**
 * Универсальный коннектор к корпоративным сайтам (Generic Corporate Site Adapter).
 * Автоматически парсит вакансии с любого корпоративного сайта через 4 каскадные стратегии.
 */
export async function fetchGenericCorporateVacancies(
  source: VacancySourceConfig,
  fetchStealth?: typeof fetchWithStealthFallback,
  renderPage?: RenderScriptPage,
): Promise<UnifiedVacancy[]> {
  const read = await readGenericCorporateVacancies(source, fetchStealth, renderPage);
  const verdict = gateCorporateVacancies(read, [source.targetUrl], source.name);
  if (!verdict.passed) throw corporateQualityError(verdict);
  return [...verdict.kept];
}

async function readGenericCorporateVacancies(
  source: VacancySourceConfig,
  fetchStealth?: typeof fetchWithStealthFallback,
  renderPage?: RenderScriptPage,
): Promise<UnifiedVacancy[]> {
  const targetUrl = source.targetUrl;
  const observedAt = new Date().toISOString();

  const directAts = detectEmbeddedAts(targetUrl);
  if (directAts && directAts.provider !== 'dou') {
    try {
      const atsJobs = await fetchFromAtsProvider(directAts, source, observedAt);
      if (atsJobs.length > 0) return atsJobs;
    } catch {
      // При ошибке прямого API пробуем загрузить HTML
    }
  }

  const html = await fetchCorporateHtml(targetUrl, fetchStealth);
  if (!html) return [];

  const fromHtml = await readVacanciesFromHtml(html, source, observedAt);
  if (fromHtml.length > 0 || !renderPage || !hasScriptPageSigns(html)) return fromHtml;
  // B643: список рисует скрипт — один рендер в браузере и тот же каскад по его HTML.
  const rendered = await renderPage(targetUrl);
  return rendered ? readVacanciesFromHtml(rendered, source, observedAt) : [];
}

async function readVacanciesFromHtml(
  html: string,
  source: VacancySourceConfig,
  observedAt: string,
): Promise<UnifiedVacancy[]> {
  const targetUrl = source.targetUrl;
  const embeddedAts = detectEmbeddedAts(targetUrl + '\n' + html);
  if (embeddedAts) {
    try {
      const atsJobs = await fetchFromAtsProvider(embeddedAts, source, observedAt, html);
      if (atsJobs.length > 0) return atsJobs;
    } catch {
      // Переходим к следующим стратегиям разбора HTML
    }
  }

  const jsonLdJobs = extractJsonLdJobs(html, targetUrl);
  if (jsonLdJobs.length > 0) return mapRawJobsToUnified(jsonLdJobs, source, observedAt);

  const nextDataJobs = extractNextDataJobs(html, targetUrl);
  if (nextDataJobs.length > 0) return mapRawJobsToUnified(nextDataJobs, source, observedAt);

  const semanticJobs = extractSemanticHtmlJobs(html, targetUrl);
  if (semanticJobs.length > 0) return mapRawJobsToUnified(semanticJobs, source, observedAt);

  return [];
}
