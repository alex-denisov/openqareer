import { parseRssJobFeed } from '../connectors/rssFeedParser';
import { normalizeJsonSource } from './jsonSourceAdapters';
import { parseTelegramChannelHtml } from '../connectors/telegramChannelParser';
import type { HhVacancySample } from '../connectors/hhVacancySearch';
import type { VacancySample } from '../domain/vacancy';
import type { UnifiedVacancy, VacancySourceConfig } from '../domain/unifiedVacancy';
import type { SourceFetcher } from './multiSourceVacancyEngine';

type HhSearch = (input: { text: string; perPage?: number }) => Promise<HhVacancySample>;
type RemotiveSearch = (input: { text: string; perPage?: number }) => Promise<VacancySample>;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; openqareer/1.0; +https://openqareer.com)',
} as const;

function hhSampleToUnified(sample: HhVacancySample, sourceId: string): UnifiedVacancy[] {
  return sample.items.map((v) => ({
    id: v.id,
    fingerprint: v.id,
    title: v.title,
    company: v.company,
    location: v.location,
    salary: v.salary
      ? {
          from: v.salary.from ?? undefined,
          to: v.salary.to ?? undefined,
          currency: v.salary.currency,
        }
      : undefined,
    description: v.title,
    requiredSkills: v.requirements ?? [],
    url: v.sourceUrl,
    provenance: {
      sourceType: 'hh' as const,
      sourceId,
      sourceUrl: v.sourceUrl,
      observedAt: new Date().toISOString(),
    },
    publishedAt: v.publishedAt ?? new Date().toISOString(),
    status: 'active' as const,
  }));
}

function remotiveSampleToUnified(sample: VacancySample, sourceId: string): UnifiedVacancy[] {
  return sample.items.map((v) => ({
    id: v.id,
    fingerprint: v.id,
    title: v.title,
    company: v.company,
    location: v.location,
    isRemote: true,
    description: v.title,
    requiredSkills: v.requirements ?? [],
    url: v.sourceUrl,
    provenance: {
      sourceType: 'remotive' as const,
      sourceId,
      sourceUrl: v.sourceUrl,
      observedAt: new Date().toISOString(),
    },
    publishedAt: v.publishedAt ?? new Date().toISOString(),
    status: 'active' as const,
  }));
}

async function fetchTelegramChannel(source: VacancySourceConfig): Promise<UnifiedVacancy[]> {
  const channelMatch = source.targetUrl.match(/t\.me\/(?:s\/)?([a-zA-Z0-9_]+)/i);
  const channelName = channelMatch ? channelMatch[1] : source.id.replace(/^src-tg-/, '');
  try {
    const res = await fetch(`https://t.me/s/${channelName}`, {
      headers: { ...FETCH_HEADERS, Accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) throw new Error(`vacancy_source_unreachable: ${res.status}`);
    const html = await res.text();
    const vacancies = parseTelegramChannelHtml(html, {
      channelName,
      sourceId: source.id,
      observedAt: new Date().toISOString(),
    });
    return vacancies;
  } catch (reason) {
    // An unreachable channel is not an empty channel. Returning [] here made
    // syncSource take its success path and paint the source «Активен» (B161).
    throw reason instanceof Error ? reason : new Error('vacancy_source_unreachable');
  }
}

/**
 * A board's own JSON endpoint. The observation time is taken before the record
 * objects are built, so `observedAt` names the moment of the request (B164).
 */
async function fetchJsonApi(
  source: VacancySourceConfig,
  options?: { query?: string },
): Promise<UnifiedVacancy[]> {
  const url = withQuery(source, options?.query);
  const res = await fetch(url, {
    headers: { ...FETCH_HEADERS, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`vacancy_source_unreachable: ${res.status}`);
  const observedAt = new Date().toISOString();
  // Имя источника нужно разбору: доски Lever и Ashby не публикуют работодателя
  // в записи, и назвать его может только реестр (B202).
  return normalizeJsonSource(source.id, await res.json(), { observedAt, sourceName: source.name });
}

/** Only the sources whose live probe proved they honour a query get one. */
const QUERY_PARAMETER: Readonly<Record<string, string>> = {
  'src-getonbrd': 'query',
  'src-habr-career': 'q',
  'src-hh-rss': 'text',
};

function withQuery(source: VacancySourceConfig, query?: string): string {
  const parameter = QUERY_PARAMETER[source.id];
  if (!parameter || !query?.trim()) return source.targetUrl;
  const url = new URL(source.targetUrl);
  url.searchParams.set(parameter, query.trim());
  return url.toString();
}

async function fetchRssFeed(
  source: VacancySourceConfig,
  options?: { query?: string },
): Promise<UnifiedVacancy[]> {
  try {
    const url = withQuery(source, options?.query);
    const res = await fetch(url, {
      headers: {
        ...FETCH_HEADERS,
        Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`vacancy_source_unreachable: ${res.status}`);
    const xml = await res.text();
    const observedAt = new Date().toISOString();
    return parseRssJobFeed(xml, {
      sourceId: source.id,
      sourceUrl: url,
      companyName: source.name,
      observedAt,
    });
  } catch (reason) {
    throw reason instanceof Error ? reason : new Error('vacancy_source_unreachable');
  }
}

export function buildMultiSourceFetcher(hh: HhSearch, remotive: RemotiveSearch): SourceFetcher {
  return async (source, options) => {
    if (source.type === 'hh') {
      const sample = await hh({ text: options?.query || 'Developer', perPage: 20 });
      return hhSampleToUnified(sample, source.id);
    }
    if (source.type === 'remotive') {
      const sample = await remotive({ text: options?.query || 'Engineer', perPage: 20 });
      return remotiveSampleToUnified(sample, source.id);
    }
    if (source.type === 'telegram') {
      return fetchTelegramChannel(source);
    }
    if (source.type === 'rss') {
      return fetchRssFeed(source, options);
    }
    if (source.type === 'json_api') {
      return fetchJsonApi(source, options);
    }
    // An unimplemented source type has not been measured, so it must not report
    // a successful empty reading (B161).
    throw new Error(`vacancy_source_type_unsupported: ${source.type}`);
  };
}
