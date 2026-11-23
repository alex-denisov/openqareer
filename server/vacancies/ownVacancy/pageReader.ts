import { OWN_VACANCY_USER_AGENT, type OwnVacancyUnreadable } from '../../../shared/b640OwnVacancy';
import { isPublicHost } from '../../connectors/publicHost';
import { createPinnedFetch, defaultResolve, pinnedFetch, privateAddress } from '../../outreach/dossier/pinnedFetch';
import { evaluateRobotsPolicy } from '../robotsParser';
import { isClosedSite } from './closedSites';

/**
 * B676: одно чтение одной страницы вакансии по действию кандидата.
 * Только публичные адреса (проверка до запроса и на каждой переадресации),
 * robots.txt домена, без cookies, честный User-Agent, без повторов после отказа.
 */
export type PageReadResult = { readonly ok: true; readonly html: string } | { readonly ok: false; readonly reason: OwnVacancyUnreadable };

/** Что видно в журнале про чтение: домен, код, байты, где остановились. Без пути, запроса и данных кандидата. */
export interface PageReadTrace {
  readonly host: string;
  readonly status: number | null;
  readonly bytes: number;
  readonly stage: 'page' | 'robots' | 'timeout' | 'blocked' | 'error' | 'too_large' | 'http_status' | 'not_html';
  readonly outcome: 'ok' | OwnVacancyUnreadable;
}

export interface PageReaderOptions {
  readonly onTrace?: (trace: PageReadTrace) => void;
  readonly fetchImpl?: typeof fetch;
  readonly resolve?: (host: string) => Promise<readonly string[]>;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

/**
 * Прод 23.11: Lever отдаёт 743 КБ за 0,3 с, но под нагрузкой веб-процесса (стоянки цикла
 * по 260–330 мс) чтение по кускам заняло 8 056 мс и упёрлось в прежние 8 с — «не открылась».
 */
const TIMEOUT_MS = 20_000;
const MAX_BYTES = 2_000_000;
const MAX_REDIRECTS = 3;
const REFUSED_STATUS = new Set([401, 403, 429, 451]);

type Hop = { readonly kind: 'response'; readonly response: Response; readonly url: URL } | { readonly kind: 'fail'; readonly reason: OwnVacancyUnreadable };

class ReadStop extends Error {
  constructor(readonly reason: OwnVacancyUnreadable) {
    super(reason);
  }
}

function parseLink(link: string): URL | null {
  try {
    return new URL(link);
  } catch {
    return null;
  }
}

async function assertPublic(url: URL, resolve: NonNullable<PageReaderOptions['resolve']>): Promise<void> {
  if (!isPublicHost(url)) throw new ReadStop('failed');
  if (isClosedSite(url)) throw new ReadStop('site_closed');
  const addresses = await resolve(url.hostname).catch(() => [] as readonly string[]);
  if (addresses.length === 0 || addresses.some(privateAddress)) throw new ReadStop('failed');
}

interface Context {
  readonly fetchImpl: typeof fetch;
  readonly resolve: NonNullable<PageReaderOptions['resolve']>;
  readonly signal: AbortSignal;
  readonly maxBytes: number;
  readonly robotsChecked: Set<string>;
  /** Последний ответ: для строки журнала (B676). */
  readonly last: { host: string; status: number | null; bytes: number; stage: PageReadTrace['stage'] };
}

const HEADERS = { 'user-agent': OWN_VACANCY_USER_AGENT, accept: 'text/html,application/xhtml+xml;q=0.9' };

/** GET с ручными переадресациями: каждый следующий адрес проверяется заново. */
async function safeGet(start: URL, context: Context, checkRobots: boolean): Promise<Hop> {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublic(url, context.resolve);
    if (checkRobots) await assertRobots(url, context);
    const response = await context.fetchImpl(url.toString(), {
      method: 'GET', headers: HEADERS, redirect: 'manual', credentials: 'omit', signal: context.signal,
    });
    Object.assign(context.last, { host: url.hostname, status: response.status, stage: checkRobots ? 'page' : 'robots' });
    if (response.status < 300 || response.status >= 400) return { kind: 'response', response, url };
    await response.body?.cancel().catch(() => undefined);
    const location = response.headers.get('location');
    const next = location ? parseLink(new URL(location, url).toString()) : null;
    if (!next) return { kind: 'fail', reason: 'failed' };
    url = next;
  }
  return { kind: 'fail', reason: 'failed' };
}

async function readBody(response: Response, maxBytes: number): Promise<string | null> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8').decode(Buffer.concat(chunks));
}

async function assertRobots(url: URL, context: Context): Promise<void> {
  if (context.robotsChecked.has(url.origin)) return;
  const hop = await safeGet(new URL('/robots.txt', url.origin), context, false);
  if (hop.kind === 'fail') throw new ReadStop('failed');
  const content = hop.response.ok ? await readBody(hop.response, 512_000) : null;
  if (!hop.response.ok) await hop.response.body?.cancel().catch(() => undefined);
  const verdict = evaluateRobotsPolicy({
    httpStatus: hop.response.status, robotsTxtContent: hop.response.ok ? content : undefined,
    path: `${url.pathname}${url.search}`, userAgent: 'openqareer',
  });
  if (verdict.verdict === 'disallowed') throw new ReadStop('site_closed');
  if (verdict.verdict !== 'allowed') throw new ReadStop('failed');
  context.robotsChecked.add(url.origin);
}

async function readPage(start: URL, context: Context): Promise<PageReadResult> {
  const hop = await safeGet(start, context, true);
  if (hop.kind === 'fail') return { ok: false, reason: hop.reason };
  const { response } = hop;
  const type = response.headers.get('content-type') ?? '';
  const htmlType = /^text\/html|^application\/xhtml\+xml/iu.test(type);
  if (!response.ok || REFUSED_STATUS.has(response.status) || !htmlType) {
    context.last.stage = htmlType ? 'http_status' : 'not_html';
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, reason: 'failed' };
  }
  const html = await readBody(response, context.maxBytes);
  context.last.bytes = html === null ? context.maxBytes : Buffer.byteLength(html);
  if (html === null) context.last.stage = 'too_large';
  return html === null ? { ok: false, reason: 'failed' } : { ok: true, html };
}

export async function readVacancyPage(link: string, options: PageReaderOptions = {}): Promise<PageReadResult> {
  const start = parseLink(link);
  if (!start) return { ok: false, reason: 'failed' };
  const context = contextFor(start, options);
  const result = await raceTimeout(readPage(start, context), context, options.timeoutMs ?? TIMEOUT_MS);
  const { host, status, bytes, stage } = context.last;
  options.onTrace?.({ host, status, bytes, stage, outcome: result.ok ? 'ok' : result.reason });
  return result;
}

type ReaderContext = Context & { readonly controller: AbortController };

function contextFor(start: URL, options: PageReaderOptions): ReaderContext {
  const resolve = options.resolve ?? defaultResolve;
  const controller = new AbortController();
  return {
    // Один агент на процесс: новый `Agent` на каждое чтение не закрывался бы.
    fetchImpl: options.fetchImpl ?? (options.resolve ? createPinnedFetch(resolve) : pinnedFetch), resolve, signal: controller.signal,
    maxBytes: options.maxBytes ?? MAX_BYTES, robotsChecked: new Set(), controller,
    last: { host: start.hostname, status: null, bytes: 0, stage: 'page' },
  };
}

async function raceTimeout(read: Promise<PageReadResult>, context: ReaderContext, timeoutMs: number): Promise<PageReadResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PageReadResult>((resolveTimeout) => {
    timer = setTimeout(() => {
      context.controller.abort();
      context.last.stage = 'timeout';
      resolveTimeout({ ok: false, reason: 'failed' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([read, timeout]);
  } catch (error) {
    if (error instanceof ReadStop) {
      context.last.stage = 'blocked';
      return { ok: false, reason: error.reason };
    }
    context.last.stage = 'error';
    return { ok: false, reason: 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
