import { htmlToFeedText } from '../connectors/feedText';
import type { HhSearchTransport } from './hhSearchFetcher';

/** Не чаще одного чтения карточки в секунду — медленнее обычного просмотра человеком. */
const DEFAULT_MIN_INTERVAL_MS = 1_000;
const DESCRIPTION_PATTERN =
  /<(div|section|article)[^>]*data-qa=["']vacancy-description["'][^>]*>([\s\S]*?)<\/\1>/i;

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

/**
 * Ленивый читатель одной карточки hh.ru. Кешируется и успешный текст, и
 * отказ: повторный клик не превращается в шквал запросов к площадке.
 */
export class HhVacancyDescriptionLoader {
  private readonly cached = new Map<string, string | undefined>();
  private lastRequestAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: HhVacancyDescriptionLoaderOptions) {}

  async load(url: string): Promise<string | undefined> {
    if (!isHhVacancyUrl(url)) return undefined;
    if (this.cached.has(url)) return this.cached.get(url);

    const now = this.options.now ?? Date.now;
    const delay = Math.max(
      0,
      (this.options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS) - (now() - this.lastRequestAt),
    );
    if (delay > 0) await this.options.sleep(delay);
    this.lastRequestAt = now();

    let description: string | undefined;
    try {
      const response = await this.options.transport(url);
      description = response.status === 200 ? descriptionFromPage(response.body) : undefined;
    } catch {
      description = undefined;
    }
    this.cached.set(url, description);
    return description;
  }
}
