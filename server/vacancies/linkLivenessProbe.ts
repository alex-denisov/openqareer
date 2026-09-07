import type { UnifiedVacancy } from '../domain/unifiedVacancy';
import { mapWithConcurrency } from './boundedConcurrency';

/**
 * B200 срез 2 — открывается ли ещё ссылка объявления.
 *
 * Живость площадки срез 1 считал по улову: сколько записей свежее 30 / 90 /
 * 180 дней. Но лента может исправно отдавать свежие даты у объявлений, которых
 * на сайте уже нет. Единственное доказательство — сходить по ссылке.
 *
 * Замер осторожный намеренно. Смертью объявления считаются только `404` и
 * `410` — ответы, которыми сервер сам говорит «этого адреса больше нет».
 * Стена антибота (`403`), защита частоты (`429`), отказ сервера (`5xx`) и
 * молчание сети не доказывают ничего и остаются «неизвестно»: похоронить живое
 * объявление хуже, чем не заметить мёртвое.
 */

/** Что дала одна проба: ответ сервера или причина, по которой ответа нет. */
export interface LinkProbeOutcome {
  readonly status?: number;
  readonly error?: string;
}

export type LinkProbe = (url: string) => Promise<LinkProbeOutcome>;

export type LinkVerdict = 'open' | 'gone' | 'unknown';

export interface LinkJudgement {
  readonly verdict: LinkVerdict;
  readonly reason: string;
}

/**
 * Перепись обхода ссылок. Каждое число называет свой знаменатель (правило
 * B192): «открылось 18 из 20, выборка из 250» читается, «90 %» скрывает и
 * размер выборки, и размер ленты.
 */
export interface LinkCheckCensus {
  readonly checkedAt: string;
  readonly open: number;
  readonly gone: number;
  readonly unknown: number;
  /** Сколько ссылок проверено. */
  readonly checked: number;
  /** Из скольких записей площадки взята выборка. */
  readonly sampledFrom: number;
}

/** Сколько ссылок проверяется за один обход площадки. */
export const DEFAULT_LINK_SAMPLE = 20;

/**
 * Сколько проб идёт одновременно. Двойка, а не залп: у площадки обычно один
 * хост, и обход её же объявлений не должен выглядеть для неё нагрузкой
 * (та же причина, что у волн опроса в `boundedConcurrency`).
 */
const DEFAULT_LINK_CONCURRENCY = 2;

export function judgeLinkOutcome(outcome: LinkProbeOutcome): LinkJudgement {
  const { status } = outcome;
  if (status === 404 || status === 410) {
    return { verdict: 'gone', reason: `Объявление снято: ответ ${status}` };
  }
  if (typeof status === 'number' && status >= 200 && status < 400) {
    return { verdict: 'open', reason: `Ссылка открывается: ответ ${status}` };
  }
  if (typeof status === 'number') {
    return { verdict: 'unknown', reason: `Ответ ${status} ничего не говорит о судьбе объявления` };
  }
  return {
    verdict: 'unknown',
    reason: `Ответа нет: ${outcome.error ?? 'причина не названа'}`,
  };
}

/**
 * Адреса, по которым продукт не ходит никогда. Ссылка приезжает с чужой
 * площадки, то есть управляется не нами: `http://169.254.169.254/` в поле
 * вакансии превратил бы обход ссылок в запрос к метаданным нашей же машины.
 */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/iu,
  /^127\./u,
  /^10\./u,
  /^192\.168\./u,
  /^169\.254\./u,
  /^172\.(1[6-9]|2\d|3[01])\./u,
  /^0\./u,
  /^\[?::1\]?$/u,
  /^\[?f[cd][0-9a-f]{2}:/iu,
  /\.local$/iu,
  /\.internal$/iu,
];

/** Ссылка, по которой можно спросить чужой сервер и только его. */
export function isPublicHttpUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname;
  if (host.length === 0) return false;
  // Имя без точки — это имя внутри нашей же сети, а не адрес в интернете.
  if (!host.includes('.') && !host.includes(':')) return false;
  return !PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host));
}

function hasProbableLink(vacancy: UnifiedVacancy): boolean {
  return isPublicHttpUrl(vacancy.url?.trim() ?? '');
}

/**
 * Выборка идёт ровным шагом по всей ленте, а не первыми записями подряд:
 * начало ленты — самые свежие объявления, и по ним доля открывающихся ссылок
 * всегда была бы выше, чем по площадке в целом.
 */
export function sampleForLinkCheck(
  vacancies: readonly UnifiedVacancy[],
  size: number,
): UnifiedVacancy[] {
  const withLink = vacancies.filter(hasProbableLink);
  const wanted = Math.max(0, Math.floor(size));
  if (wanted === 0) return [];
  if (withLink.length <= wanted) return [...withLink];

  const step = Math.floor(withLink.length / wanted);
  const sample: UnifiedVacancy[] = [];
  for (let index = 0; index < withLink.length && sample.length < wanted; index += step) {
    sample.push(withLink[index]!);
  }
  return sample;
}

export interface LinkProbeOptions {
  readonly sample?: number;
  readonly concurrency?: number;
  readonly nowMs?: number;
}

export interface LinkProbeReport {
  readonly census: LinkCheckCensus;
  /** Записи, чей адрес сервер сам объявил несуществующим. */
  readonly goneVacancyIds: readonly string[];
}

/** Обходит выборку ссылок площадки и считает, сколько из них ещё открывается. */
export async function probeVacancyLinks(
  vacancies: readonly UnifiedVacancy[],
  probe: LinkProbe,
  options: LinkProbeOptions = {},
): Promise<LinkProbeReport> {
  const nowMs = options.nowMs ?? Date.now();
  const sample = sampleForLinkCheck(vacancies, options.sample ?? DEFAULT_LINK_SAMPLE);

  const judged = await mapWithConcurrency(
    sample,
    options.concurrency ?? DEFAULT_LINK_CONCURRENCY,
    async (vacancy) => {
      // Исключение самой пробы — это тоже «ответа нет», а не приговор
      // объявлению: обход обязан дойти до конца и назвать причину.
      let outcome: LinkProbeOutcome;
      try {
        outcome = await probe(vacancy.url!.trim());
      } catch (error) {
        outcome = { error: error instanceof Error ? error.message : String(error) };
      }
      return { vacancy, judgement: judgeLinkOutcome(outcome) };
    },
  );

  let open = 0;
  let gone = 0;
  let unknown = 0;
  const goneVacancyIds: string[] = [];
  for (const { vacancy, judgement } of judged) {
    if (judgement.verdict === 'open') open += 1;
    else if (judgement.verdict === 'gone') {
      gone += 1;
      goneVacancyIds.push(vacancy.id);
    } else unknown += 1;
  }

  return {
    census: {
      checkedAt: new Date(nowMs).toISOString(),
      open,
      gone,
      unknown,
      checked: judged.length,
      sampledFrom: vacancies.length,
    },
    goneVacancyIds,
  };
}

/**
 * Сколько ждём ответа по ссылке. Проверка живости объявления не стоит того,
 * чтобы держать соединение дольше самого опроса площадки (`8_000` там же).
 */
const LINK_PROBE_TIMEOUT_MS = 8_000;

/** Ответы, которыми площадка говорит «этот метод я не принимаю». */
const HEAD_NOT_SUPPORTED = new Set([405, 501]);

export interface HttpLinkProbeOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Проба по сети: сначала `HEAD` — тело объявления нам не нужно, а площадке
 * дешевле. Площадке, которая `HEAD` не принимает, задаётся тот же вопрос
 * страницей: иначе её объявления навсегда остались бы «неизвестно».
 *
 * Продукт представляется своим именем (та же строка, что у опроса площадок):
 * обход, который прячется, — это обход, о котором площадка не договаривалась.
 */
export function createHttpLinkProbe(options: HttpLinkProbeOptions = {}): LinkProbe {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? LINK_PROBE_TIMEOUT_MS;

  async function ask(url: string, method: 'HEAD' | 'GET'): Promise<Response> {
    return fetchImpl(url, {
      method,
      // Переход не выполняется: адрес назначения выбирает чужая площадка, и
      // следовать за ним — значит снова открыть тот же путь во внутреннюю сеть.
      // Ответ `3xx` сам по себе доказывает, что объявление на месте.
      redirect: 'manual',
      headers: { 'User-Agent': 'openqareer/1.0 (support@openqareer.com)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  }

  return async (url: string): Promise<LinkProbeOutcome> => {
    try {
      const head = await ask(url, 'HEAD');
      if (!HEAD_NOT_SUPPORTED.has(head.status)) return { status: head.status };
      const page = await ask(url, 'GET');
      return { status: page.status };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  };
}
