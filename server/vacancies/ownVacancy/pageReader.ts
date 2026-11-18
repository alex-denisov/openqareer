import { OWN_VACANCY_USER_AGENT, type OwnVacancyUnreadable } from '../../../shared/b640OwnVacancy';
import { isPublicHost } from '../../connectors/publicHost';
import { createPinnedFetch, defaultResolve, privateAddress } from '../../outreach/dossier/pinnedFetch';
import { evaluateRobotsPolicy } from '../robotsParser';
import { isClosedSite } from './closedSites';

/**
 * B676: одно чтение одной страницы вакансии по действию кандидата.
 * Только публичные адреса (проверка до запроса и на каждой переадресации),
 * robots.txt домена, без cookies, честный User-Agent, без повторов после отказа.
 */
export type PageReadResult = { readonly ok: true; readonly html: string } | { readonly ok: false; readonly reason: OwnVacancyUnreadable };

export interface PageReaderOptions {
  readonly fetchImpl?: typeof fetch;
  readonly resolve?: (host: string) => Promise<readonly string[]>;
  readonly timeoutMs?: number;
  readonly maxBytes?: number;
}

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 1_500_000;
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
  if (!response.ok || REFUSED_STATUS.has(response.status) || !/^text\/html|^application\/xhtml\+xml/iu.test(type)) {
    await response.body?.cancel().catch(() => undefined);
    return { ok: false, reason: 'failed' };
  }
  const html = await readBody(response, context.maxBytes);
  return html === null ? { ok: false, reason: 'failed' } : { ok: true, html };
}

export async function readVacancyPage(link: string, options: PageReaderOptions = {}): Promise<PageReadResult> {
  const start = parseLink(link);
  if (!start) return { ok: false, reason: 'failed' };
  const resolve = options.resolve ?? defaultResolve;
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const context: Context = {
    fetchImpl: options.fetchImpl ?? createPinnedFetch(resolve), resolve, signal: controller.signal,
    maxBytes: options.maxBytes ?? MAX_BYTES, robotsChecked: new Set(),
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<PageReadResult>((resolveTimeout) => {
    timer = setTimeout(() => {
      controller.abort();
      resolveTimeout({ ok: false, reason: 'failed' });
    }, timeoutMs);
  });
  try {
    return await Promise.race([readPage(start, context), timeout]);
  } catch (error) {
    return { ok: false, reason: error instanceof ReadStop ? error.reason : 'failed' };
  } finally {
    clearTimeout(timer);
  }
}
