import { decodeFeedEntities, htmlToFeedText } from '../connectors/feedText';
import type { HhSearchTransport } from './hhSearchFetcher';
import type { HhTextRateController } from './hhTextRate';

/** Не чаще одного чтения карточки в секунду — медленнее обычного просмотра человеком. */
const DEFAULT_MIN_INTERVAL_MS = 1_000;
const DEFAULT_MAX_PENDING_REQUESTS = 40;
const DESCRIPTION_PATTERN =
  /<(div|section|article)[^>]*data-qa=["']vacancy-description["'][^>]*>([\s\S]*?)<\/\1>/i;

export interface HhVacancyDetails {
  readonly description?: string;
  readonly skills: readonly string[];
  /** Работодатель снял вакансию (статус в данных страницы) или удалил её (ответ 404). */
  readonly archived?: boolean;
  /**
   * Признак блокировки площадки (B535): `refused` — hh ответил 403/429/451,
   * `backoff` — загрузчик выжидает после такого отказа и запроса не делал.
   */
  readonly blocked?: 'refused' | 'backoff';
  /** 02.11: «работодатель ограничил доступ» — текста этой карточке не будет, это не сбой. */
  readonly restricted?: boolean;
}

/** Ответы, которыми hh отказывает нам, а не одной карточке. */
const REFUSAL_STATUSES = new Set([403, 429, 451]);
const BACKOFF: HhVacancyDetails = { blocked: 'backoff', skills: [] };

// Статус самой вакансии в данных страницы. Текст «Вакансия в архиве» не годится:
// он есть в словаре переводов каждой страницы hh и снимал живые вакансии (B312).
/**
 * 403 for one card: «Работодатель ограничил доступ». Not the i18n text (every page has it,
 * B312) but the page state. It fails that card only; a bare 403 is still a platform refusal.
 */
const FORBIDDEN_VACANCY_MARKER =
  /(?:&#34;|")forbidden(?:&#34;|"):true,(?:&#34;|")errorPage(?:&#34;|"):\{(?:&#34;|")isError(?:&#34;|"):true/u;
export function isForbiddenVacancyPage(body: string | undefined): boolean {
  return Boolean(body) && FORBIDDEN_VACANCY_MARKER.test(body!);
}
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
  /**
   * 03.11: запросов в полёте одновременно. Старты по-прежнему разнесены на
   * `minIntervalMs`, так что скорость не выше одного запроса в секунду; конвейер
   * лишь не ждёт ответа перед следующим стартом. По умолчанию 1 (как раньше).
   */
  readonly maxConcurrent?: number;
  /** 03.11: адаптивный темп (AIMD); если задан, он заменяет `minIntervalMs` и `maxConcurrent`. */
  readonly rate?: HhTextRateController;
}

/** Страница-заглушка антибота: ответ 200 без карточки, но с маркером капчи. */
const CAPTCHA_MARKER = /captcha/i;

/** Пауза после отказа удваивается с каждым подряд идущим, но не дольше этого. */
const MAX_REFUSAL_BACKOFF_MS = 15 * 60 * 1_000;
/** Столько подряд ответов 5xx/сбоев сети считаются сбоем площадки, а не карточки. */
const TRANSIENT_STREAK_TO_PAUSE = 3;

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

function detailsFromPage(body: string): HhVacancyDetails | undefined {
  if (ARCHIVED_MARKER.test(body)) return { archived: true, skills: [] };
  const description = descriptionFromPage(body);
  const skills = skillsFromPage(body);
  return description || skills.length > 0 ? { description, skills } : undefined;
}

/**
 * Ленивый читатель одной карточки hh.ru. Успех кешируется, а отказ — только
 * на короткий TTL, чтобы временная ошибка не лишала вакансию требований навсегда.
 */
export class HhVacancyDescriptionLoader {
  private readonly cached = new Map<string, CachedHhVacancyDetails>();
  private readonly inFlight = new Map<string, Promise<HhVacancyDetails | undefined>>();
  private requestQueue: Promise<void> = Promise.resolve();
  private active = 0;
  private readonly slotWaiters: Array<() => void> = [];
  private refusalStreak = 0;
  private transientStreak = 0;
  private lastRequestAt = Number.NEGATIVE_INFINITY;
  private retryAfter = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: HhVacancyDescriptionLoaderOptions) {}

  rateControl(): HhTextRateController | undefined {
    return this.options.rate;
  }

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
    if (this.retryAfter > (this.options.now ?? Date.now)()) return Promise.resolve(BACKOFF);
    const maxPendingRequests = Math.max(
      1,
      Math.floor(this.options.maxPendingRequests ?? DEFAULT_MAX_PENDING_REQUESTS),
    );
    if (this.inFlight.size >= maxPendingRequests) return Promise.resolve(BACKOFF);

    // Очередь держит только старт запроса (слот и пауза), не ответ: так ответы перекрываются.
    const started = this.requestQueue.then(() => this.start(url));
    this.requestQueue = started.then(
      () => undefined,
      () => undefined,
    );
    const request = started.then((early) => (early.done ? early.details : this.finish(url)));
    this.inFlight.set(url, request);
    void request.then(
      () => this.inFlight.delete(url),
      () => this.inFlight.delete(url),
    );
    return request;
  }

  private async acquireSlot(): Promise<void> {
    const max = this.options.rate
      ? this.options.rate.maxInFlight()
      : Math.max(1, Math.floor(this.options.maxConcurrent ?? 1));
    while (this.active >= max) {
      await new Promise<void>((resolve) => this.slotWaiters.push(resolve));
    }
    this.active += 1;
  }

  private releaseSlot(): void {
    this.active -= 1;
    this.slotWaiters.shift()?.();
  }

  /** Ждёт слот и паузу между стартами; `done` — ответ уже известен без сети. */
  private async start(
    url: string,
  ): Promise<{ done: true; details: HhVacancyDetails | undefined } | { done: false }> {
    if (this.isLoaded(url)) return { done: true, details: this.cached.get(url)?.details };
    const now = this.options.now ?? Date.now;
    if (this.retryAfter > now()) return { done: true, details: BACKOFF };
    await this.acquireSlot();
    const delay = Math.max(
      0,
      (this.options.rate?.intervalMs() ?? this.options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS) -
        (now() - this.lastRequestAt),
    );
    try {
      if (delay > 0) await this.options.sleep(delay);
    } catch (error) {
      this.releaseSlot();
      throw error;
    }
    this.lastRequestAt = now();
    return { done: false };
  }

  private async finish(url: string): Promise<HhVacancyDetails | undefined> {
    try {
      return await this.loadFromTransport(url);
    } finally {
      this.releaseSlot();
    }
  }

  /** 03.11: подряд идущие отказы удваивают паузу (60 с, 2, 4 ... до 15 мин); сбои 5xx — после серии. */
  private extendPause(
    refused: boolean,
    baseMs: number,
    jitterMs: number,
    nowMs: number,
    serverWaitMs = 0,
  ): void {
    if (refused) {
      this.refusalStreak += 1;
      const grown = Math.min(baseMs * 2 ** (this.refusalStreak - 1), MAX_REFUSAL_BACKOFF_MS);
      const waited = Math.max(grown + jitterMs, Math.min(serverWaitMs, MAX_REFUSAL_BACKOFF_MS));
      this.retryAfter = Math.max(this.retryAfter, nowMs + waited);
    } else if (this.transientStreak >= TRANSIENT_STREAK_TO_PAUSE) {
      const grown = Math.min(
        baseMs * 2 ** (this.transientStreak - TRANSIENT_STREAK_TO_PAUSE),
        MAX_REFUSAL_BACKOFF_MS,
      );
      this.retryAfter = Math.max(this.retryAfter, nowMs + grown);
    }
  }

  private recordRate(refused: boolean, transient: boolean): void {
    this.options.rate?.record(refused ? 'refusal' : transient ? 'server_error' : 'ok');
  }

  private async loadFromTransport(url: string): Promise<HhVacancyDetails | undefined> {
    const now = this.options.now ?? Date.now;
    let details: HhVacancyDetails | undefined;
    let refused = false;
    let restricted = false;
    let transient = false;
    let serverWaitMs = 0;
    try {
      const response = await this.options.transport(url);
      transient = response.status === 429 || response.status >= 500;
      refused =
        REFUSAL_STATUSES.has(response.status) && !FORBIDDEN_VACANCY_MARKER.test(response.body);
      restricted = response.status === 403 && FORBIDDEN_VACANCY_MARKER.test(response.body);
      serverWaitMs = response.retryAfterMs ?? 0;
      // 01.11: hh отвечает 404 на удалённую вакансию — это статус ответа, не текст страницы.
      if (response.status === 404) details = { archived: true, skills: [] };
      else if (response.status === 200) {
        details = detailsFromPage(response.body);
        if (!details && CAPTCHA_MARKER.test(response.body)) refused = true;
      }
    } catch {
      transient = true;
    }
    this.recordRate(refused, transient);
    if (details || restricted) {
      this.refusalStreak = 0;
      this.transientStreak = 0;
    } else if (transient && !refused) {
      this.transientStreak += 1;
    }
    if (details) {
      this.cached.set(url, { details });
      return details;
    }
    const failedCacheTtlMs = Math.max(0, this.options.failedCacheTtlMs ?? 60_000);
    if (failedCacheTtlMs > 0) {
      const jitterBound = Math.max(0, this.options.failedCacheJitterMs ?? 5_000);
      const random = Math.max(0, Math.min(1, (this.options.random ?? Math.random)()));
      const retryAt = now() + failedCacheTtlMs + Math.floor(random * jitterBound);
      this.cached.set(url, { retryAt });
      // Общая пауза — только когда hh отказывает нам; сбой одной карточки
      // (404, страница без описания, сеть) остальных не держит (прод 21.10).
      this.extendPause(
        refused,
        failedCacheTtlMs,
        retryAt - now() - failedCacheTtlMs,
        now(),
        serverWaitMs,
      );
    }
    if (refused) return { blocked: 'refused', skills: [] };
    // Не кешируется как ответ: повтор через отступ решает, скрыт ли текст насовсем.
    return restricted ? { restricted: true, skills: [] } : undefined;
  }
}
