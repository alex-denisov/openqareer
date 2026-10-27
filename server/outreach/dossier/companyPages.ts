import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { searchExaPages } from '../../osint/adapters/exaAdapter';
import { createWaybackAdapter } from '../../osint/adapters/waybackAdapter';
import type { DossierDeps } from './collectRecruiterDossier';
import { formatsOf, inferEmailFormat, samplesFromText } from './emailFormat';
import type { EmailFormat, EmailSample } from './emailFormat';
import { sharedFootprintRequestGate } from '../../osint/adapters/requestScheduler';

/** Базы контактов и «форматы почты»: чужие сборки, не публикация человека или компании. */
export const CONTACT_BROKERS = [
  'clay.com', 'rocketreach.co', 'zoominfo.com', 'leadiq.com', 'signalhire.com', 'contactout.com', 'hunter.io',
  'apollo.io', 'lusha.com', 'email-format.com', 'emailformat.net', 'adapt.io', 'snov.io', 'skrapp.io', 'voilanorbert.com',
  'peopledatalabs.com', 'spokeo.com', 'whitepages.com', 'truepeoplesearch.com', 'beenverified.com', 'radaris.com',
  'nuwber.com', 'datanyze.com', 'uplead.com', 'kaspr.io', 'getprospect.com', 'findemails.com', 'emailsherlock.com',
];

export function isContactBroker(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./u, '');
    return CONTACT_BROKERS.some((site) => host === site || host.endsWith(`.${site}`)) || /email[-_]?format/iu.test(url);
  } catch {
    return true;
  }
}

/** Страницы сайта, где компании обычно публикуют людей и адреса. */
export const COMPANY_PAGE_PATHS = ['/team', '/about', '/careers', '/contacts', '/contact', '/kontakty', '/o-kompanii'] as const;

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 100_000;
const MAX_SAMPLES = 50;
const MAX_SNIPPETS = 40;
const SNIPPET_CHARS = 250;
const CONTACT_MARK = /\+?\d[\d ()-]{8,18}\d|t\.me\/|wa\.me\/|viber:/gu;

function contactSnippets(page: { url: string; text: string }): CompanySnippet[] {
  const snippets: CompanySnippet[] = [];
  let covered = 0;
  for (const match of page.text.matchAll(CONTACT_MARK)) {
    // Соседние контакты попадают в один фрагмент.
    if (match.index < covered) continue;
    const end = match.index + match[0].length + SNIPPET_CHARS;
    snippets.push({ text: page.text.slice(Math.max(0, match.index - SNIPPET_CHARS), end), sourceUrl: page.url });
    covered = end;
    if (snippets.length >= 10) break;
  }
  return snippets;
}

const EXA_PAGES = 6;
const EXA_PAGE_CHARS = 6_000;
/** Страниц из архива на домен: снимки снятых со страниц команд и контактов. */
const ARCHIVE_PAGES = 3;

export interface CompanySample extends EmailSample {
  readonly sourceUrl: string;
}

/** Фрагмент страницы компании вокруг телефона или мессенджера: чей он — решается по имени рядом. */
export interface CompanySnippet {
  readonly text: string;
  readonly sourceUrl: string;
}

export interface CompanyPagesResult {
  readonly samples: CompanySample[];
  readonly snippets?: CompanySnippet[];
  readonly format: (EmailFormat & { readonly sourceUrl: string }) | null;
  readonly complete: boolean;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]{0,500}>[^<]{0,100000}<\/script>/giu, ' ')
    .replace(/<a [^>]{0,500}?href="mailto:([^"?]{1,200})[^"]{0,200}"[^>]{0,500}>/giu, ' $1 ')
    .replace(/<[^>]{1,500}>/gu, ' ')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&amp;/gu, '&');
}

const PUBLIC_FQDN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/u;
const INTERNAL_SUFFIX = /\.(?:local|localhost|internal|lan|home|corp|test|invalid|example)$/u;

function privateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const v6 = address.toLowerCase();
    if (v6.startsWith('::ffff:')) return privateAddress(v6.slice(7));
    return v6 === '::1' || v6 === '::' || /^f[cd]/u.test(v6) || /^fe[89ab]/u.test(v6);
  }
  const [a = 0, b = 0] = address.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
}

async function defaultLookup(host: string): Promise<readonly string[]> {
  return (await lookup(host, { all: true })).map((entry) => entry.address);
}

/** Только публичное имя, все адреса которого вне частных сетей. */
export async function isPublicCompanyDomain(domain: string, deps: DossierDeps): Promise<boolean> {
  if (!PUBLIC_FQDN.test(domain) || INTERNAL_SUFFIX.test(domain)) return false;
  try {
    const addresses = await (deps.lookupHost ?? defaultLookup)(domain);
    return addresses.length > 0 && !addresses.some(privateAddress);
  } catch {
    return false;
  }
}

async function readLimited(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_BODY_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
  }
  await reader.cancel().catch(() => undefined);
  return new TextDecoder().decode(Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES));
}

/** Открытая HTML-страница как текст, с лимитом размера; failed — отказ по частоте или сеть. */

type PageResult = { text: string | null; failed: boolean; image?: string | null };

const MAX_REDIRECTS = 3;

export async function fetchPublicPage(url: string, deps: DossierDeps): Promise<PageResult> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await fetchOnce(current, deps);
    if (!('redirect' in result)) return result;
    current = result.redirect;
  }
  return { text: null, failed: false };
}

function siteOf(host: string): string {
  return host.toLowerCase().replace(/^www\./u, '');
}

/** Переадресация в пределах того же сайта: efko.ru → www.efko.ru, архив → архив; на чужой хост не идём. */
function sameSite(from: URL, to: URL): boolean {
  if (to.protocol !== 'https:') return false;
  const a = siteOf(from.hostname);
  const b = siteOf(to.hostname);
  return a === b || b.endsWith(`.${a}`);
}

/** Фото профиля со страницы (og:image): для сравнения с фото исходного профиля. */
export function ogImage(html: string): string | null {
  const match = /<meta[^>]{0,40}property="og:image"[^>]{0,40}content="(https:\/\/[^"]{1,600})"/u.exec(html);
  return match ? match[1]!.replace(/&amp;/gu, '&') : null;
}

async function fetchOnce(url: string, deps: DossierDeps): Promise<PageResult | { redirect: string }> {
  const fetcher = deps.fetch ?? globalThis.fetch;
  const gate = deps.requestGate ?? sharedFootprintRequestGate;
  try {
    return await gate.run(new URL(url).hostname, AbortSignal.timeout(REQUEST_TIMEOUT_MS), async () => {
      const response = await fetcher(url, {
        headers: { accept: 'text/html', 'user-agent': 'openqareer-contact-check' },
        redirect: 'manual',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status === 429) return { text: null, failed: true };
      const location = response.headers.get('location');
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => undefined);
        const next = new URL(location, url);
        return sameSite(new URL(url), next) ? { redirect: next.href } : { text: null, failed: false };
      }
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !/text\/html|text\/plain/u.test(type)) {
        await response.body?.cancel().catch(() => undefined);
        return { text: null, failed: false };
      }
      const html = await readLimited(response);
      return { text: htmlToText(html), failed: false, image: ogImage(html) };
    });
  } catch (error) {
    // Таймаут — повод повторить позже; ошибка сертификата или DNS — свойство сайта, а не отказ.
    const timedOut = error instanceof Error && /timeout|abort/iu.test(`${error.name} ${error.message}`);
    return { text: null, failed: timedOut };
  }
}

/**
 * Последние снимки Internet Archive для страниц, которых на живом сайте нет:
 * снятые страницы команды и контактов по-прежнему показывают формулу адресов.
 */
async function archivedPages(domain: string, livePages: readonly string[], deps: DossierDeps): Promise<Array<{ url: string; text: string }>> {
  const wayback = createWaybackAdapter({
    ...(deps.fetch ? { fetch: deps.fetch } : {}),
    ...(deps.requestGate ? { requestGate: deps.requestGate } : {}),
    ...(deps.lookupHost ? { resolveHost: deps.lookupHost } : {}),
  });
  const found: Array<{ url: string; text: string }> = [];
  for (const path of COMPANY_PAGE_PATHS) {
    if (found.length >= ARCHIVE_PAGES) break;
    const original = `https://${domain}${path}`;
    if (livePages.includes(original)) continue;
    let latest: string | undefined;
    try {
      // Архив отдаёт до 20 снимков с самых ранних: старая страница команды тоже показывает формулу.
      const captures = await wayback.run({ profileUrl: original }, AbortSignal.timeout(REQUEST_TIMEOUT_MS));
      latest = captures.map((capture) => capture.url).filter((url): url is string => Boolean(url)).sort().at(-1);
    } catch {
      // Отказ архива (в том числе по частоте) — остальные пути не спрашиваем.
      break;
    }
    if (!latest) continue;
    // id_ отдаёт снимок без обвязки архива — текст страницы как был.
    const raw = latest.replace(/\/web\/(\d{14})\//u, '/web/$1id_/');
    const page = await fetchPublicPage(raw, deps);
    if (page.failed) break;
    if (page.text) found.push({ url: latest, text: page.text });
  }
  return found;
}

function onOwnSite(url: string, domain: string): boolean {
  try {
    const host = new URL(url.replace(/^https:\/\/web\.archive\.org\/web\/\d{14}(?:id_)?\//u, '')).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}

/** Люди с адресами со страниц самой компании и упоминаний её домена в открытом поиске. */
export async function collectCompanyPages(domain: string, deps: DossierDeps): Promise<CompanyPagesResult> {
  const pages: Array<{ url: string; text: string }> = [];
  let failed = false;
  if (!(await isPublicCompanyDomain(domain, deps))) return { samples: [], snippets: [], format: null, complete: true };
  for (const path of COMPANY_PAGE_PATHS) {
    const url = `https://${domain}${path}`;
    const page = await fetchPublicPage(url, deps);
    // Отказ сайта по частоте — остальные страницы не запрашиваем.
    if (page.failed) {
      failed = true;
      break;
    }
    if (page.text) pages.push({ url, text: page.text });
  }
  if (!failed) pages.push(...(await archivedPages(domain, pages.map((page) => page.url), deps)));
  if (deps.exaApiKey) {
    try {
      const hits = await searchExaPages(`"@${domain}"`, deps.exaApiKey, AbortSignal.timeout(REQUEST_TIMEOUT_MS), {
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.requestGate ? { requestGate: deps.requestGate } : {}),
        numResults: EXA_PAGES,
        contents: { text: { maxCharacters: EXA_PAGE_CHARS } },
      });
      // Сервисы «формат почты компании» — догадки третьих лиц, а не адреса, опубликованные компанией.
      pages.push(...hits.filter((hit) => !isContactBroker(hit.url)).map((hit) => ({ url: hit.url, text: hit.text })));
    } catch {
      failed = true;
    }
  }
  const samples: CompanySample[] = [];
  for (const page of pages) {
    for (const sample of samplesFromText(page.text, domain)) {
      if (samples.length < MAX_SAMPLES && !samples.some((known) => known.email === sample.email)) samples.push({ ...sample, sourceUrl: page.url });
    }
  }
  // Телефоны — только со страниц самой компании и их архива, не со сторонних сайтов из поиска.
  const snippets = pages.filter((page) => onOwnSite(page.url, domain)).flatMap(contactSnippets).slice(0, MAX_SNIPPETS);
  const format = inferEmailFormat(samples);
  const example = format ? samples.find((sample) => formatsOf(sample).includes(format.id)) : undefined;
  return {
    samples,
    snippets,
    format: format && example ? { ...format, sourceUrl: example.sourceUrl } : null,
    complete: !failed,
  };
}

