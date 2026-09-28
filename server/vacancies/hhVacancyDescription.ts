import { decodeFeedEntities, htmlToFeedText } from '../connectors/feedText';
import type { HhSearchTransport } from './hhSearchFetcher';

/** Не чаще одного чтения карточки в секунду — медленнее обычного просмотра человеком. */
const DEFAULT_MIN_INTERVAL_MS = 1_000;
const DESCRIPTION_PATTERN =
  /<(div|section|article)[^>]*data-qa=["']vacancy-description["'][^>]*>([\s\S]*?)<\/\1>/i;

export interface HhVacancyDetails {
  readonly description?: string;
  readonly skills: readonly string[];
}

export interface HhVacancyDescriptionLoaderOptions {
  readonly transport: HhSearchTransport;
  readonly sleep: (ms: number) => Promise<void>;
  readonly now?: () => number;
  readonly minIntervalMs?: number;
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
 * Ленивый читатель одной карточки hh.ru. Кешируется и успешный текст, и
 * отказ: повторный клик не превращается в шквал запросов к площадке.
 */
export class HhVacancyDescriptionLoader {
  private readonly cached = new Map<string, HhVacancyDetails | undefined>();
  private lastRequestAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: HhVacancyDescriptionLoaderOptions) {}

  isLoaded(url: string): boolean {
    return this.cached.has(url);
  }

  async load(url: string): Promise<HhVacancyDetails | undefined> {
    if (!isHhVacancyUrl(url)) return undefined;
    if (this.cached.has(url)) return this.cached.get(url);

    const now = this.options.now ?? Date.now;
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
        details = description || skills.length > 0 ? { description, skills } : undefined;
      } else {
        details = undefined;
      }
    } catch {
      details = undefined;
    }
    this.cached.set(url, details);
    return details;
  }
}

