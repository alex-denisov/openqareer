import { decodeFeedEntities, htmlToFeedText } from '../connectors/feedText';
import type { HhSearchTransport } from './hhSearchFetcher';

/** Не чаще одного чтения карточки в секунду — медленнее обычного просмотра человеком. */
const DEFAULT_MIN_INTERVAL_MS = 1_000;
const DEFAULT_MAX_PENDING_REQUESTS = 40;
const DESCRIPTION_PATTERN =
  /<(div|section|article)[^>]*data-qa=["']vacancy-description["'][^>]*>([\s\S]*?)<\/\1>/i;

export interface HhVacancyDetails {
  readonly description?: string;
  readonly skills: readonly string[];
  /** Работодатель снял вакансию: страница отвечает 200, но показывает «Вакансия в архиве». */
  readonly archived?: boolean;
}

// Статус самой вакансии в данных страницы. Текст «Вакансия в архиве» не годится:
// он есть в словаре переводов каждой страницы hh и снимал живые вакансии (B312).
const ARCHIVED_MARKER = /(?:&#34;|")status(?:&#34;|"):\{(?:&#34;|")archived(?:&#34;|"):true/u;

export interface HhVacancyDescriptionLoaderOptions {
  readonly transport: HhSearchTransport;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly minIntervalMs?: number;
  readonly failedCacheTtlMs?: number;
  readonly failedCacheJitterMs?: number;
  readonly random?: () => number;
  readonly maxPendingRequests?: number;
}

interface CachedHhVacancyDetails {
  readonly details?: HhVacancyDetails;
  readonly retryAt?: number;
}

function isHhVacancyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && (url.hostname === 'hh.ru' || url.hostname.endsWith('.hh.ru'))
    );
  } catch {
    return false;
  }
}

function descriptionFromPage(page: string): string | undefined {
  const match = DESCRIPTION_PATTERN.exec(page);
  const description = match ? htmlToFeedText(match[2]) : '';
  return description || undefined;
}

function skillsFromPage(page: string): string[] {
  const pattern =
    /<(?:div|span|li)[^>]*data-qa=["'][^"']*skills-element[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|li)>/gi;
  const skills: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(page)) !== null) {
    const raw = match[1].replace(/<[^>]+>/g, ' ');
    const text = decodeFeedEntities(raw).replace(/\s+/g, ' ').trim();
    if (text && !skills.includes(text)) {
      skills.push(text);
    }
  }
  if (skills.length > 0) return skills;

  const fallbackPattern =
    /<(?:div|span|li)[^>]*data-qa=["'][^"']*bloko-tag__text[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|li)>/gi;
  while ((match = fallbackPattern.exec(page)) !== null) {
    const raw = match[1].replace(/<[^>]+>/g, ' ');
    const text = decodeFeedEntities(raw).replace(/\s+/g, ' ').trim();
    if (text && !skills.includes(text)) {
      skills.push(text);
    }
  }
  return skills;
}

/**
 * Ленивый читатель одной карточки hh.ru. Успех кешируется, а отказ — только
 * на короткий TTL, чтобы временная ошибка не лишала вакансию требований навсегда.
 */
export class HhVacancyDescriptionLoader {
  private readonly cached = new Map<string, CachedHhVacancyDetails>();
  private readonly inFlight = new Map<string, Promise<HhVacancyDetails | undefined>>();
  private requestQueue: Promise<void> = Promise.resolve();
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private retryAfter = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: HhVacancyDescriptionLoaderOptions) {}

  isLoaded(url: string): boolean {
    const cached = this.cached.get(url);
    if (!cached) return false;
    if (cached.retryAt !== undefined && cached.retryAt <= (this.options.now ?? Date.now)()) {
      this.cached.delete(url);
      return false;
    }
    return true;
  }

  load(url: string): Promise<HhVacancyDetails | undefined> {
    if (!isHhVacancyUrl(url)) return Promise.resolve(undefined);
    if (this.isLoaded(url)) return Promise.resolve(this.cached.get(url)?.details);
    const pending = this.inFlight.get(url);
    if (pending) return pending;
    if (this.retryAfter > (this.options.now ?? Date.now)()) return Promise.resolve(undefined);
    const maxPendingRequests = Math.max(
      1,
      Math.floor(this.options.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS),
    );
    if (this.inFlight.size >= maxPendingRequests) return Promise.resolve(undefined);

    const request = this.requestQueue.then(() => this.loadFromTransport(url));
    this.requestQueue = request.then(
      () => undefined,
      () => undefined,
    );
    this.inFlight.set(url, request);
    void request.then(
      () => this.inFlight.delete(url),
      () => this.inFlight.delete(url),
    );
    return request;
  }

  private async loadFromTransport(url: string): Promise<HhVacancyDetails | undefined> {
    if (this.isLoaded(url)) return this.cached.get(url)?.details;

    const now = this.options.now ?? Date.now;
    if (this.retryAfter > now()) return undefined;
    const delay = Math.max(
      0,
      (this.options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS) - (now() - this.lastRequestAt),
    );
    if (delay > 0) await this.options.sleep(delay);
    this.lastRequestAt = now();

    let details: HhVacancyDetails | undefined;
    try {
      const response = await this.options.transport(url);
      if (response.status === 200) {
        const description = descriptionFromPage(response.body);
        const skills = skillsFromPage(response.body);
        if (ARCHIVED_MARKER.test(response.body)) details = { archived: true, skills: [] };
        else details = description || skills.length > 0 ? { description, skills } : undefined;
      } else {
        details = undefined;
      }
    } catch {
      details = undefined;
    }
    if (details) {
      this.cached.set(url, { details });
    } else {
      const failedCacheTtlMs = Math.max(0, this.options.failedCacheTtlMs ?? 60_000);
      if (failedCacheTtlMs > 0) {
        const jitterBound = Math.max(0, this.options.failedCacheJitterMs ?? 5_000);
        const random = Math.max(0, Math.min(1, (this.options.random ?? Math.random)()));
        const jitter = Math.floor(random * jitterBound);
        const retryAt = now() + failedCacheTtlMs + jitter;
        this.cached.set(url, { retryAt });
        this.retryAfter = Math.max(this.retryAfter, retryAt);
      }
    }
    return details;
  }
}
