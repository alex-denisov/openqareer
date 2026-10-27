import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { searchExaPages } from '../../osint/adapters/exaAdapter';
import type { DossierDeps } from './collectRecruiterDossier';
import { formatsOf, inferEmailFormat, samplesFromText } from './emailFormat';
import type { EmailFormat, EmailSample } from './emailFormat';
import { sharedFootprintRequestGate } from '../../osint/adapters/requestScheduler';

/** Страницы сайта, где компании обычно публикуют людей и адреса. */
export const COMPANY_PAGE_PATHS = ['/team', '/about', '/careers', '/contacts', '/contact', '/kontakty', '/o-kompanii'] as const;

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_BODY_BYTES = 100_000;
const MAX_SAMPLES = 50;
const EXA_PAGES = 6;
const EXA_PAGE_CHARS = 6_000;

export interface CompanySample extends EmailSample {
  readonly sourceUrl: string;
}

export interface CompanyPagesResult {
  readonly samples: CompanySample[];
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

async function sitePage(url: string, deps: DossierDeps): Promise<{ text: string | null; failed: boolean }> {
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
      const type = response.headers.get('content-type') ?? '';
      if (!response.ok || !/text\/html|text\/plain/u.test(type)) {
        await response.body?.cancel().catch(() => undefined);
        return { text: null, failed: false };
      }
      return { text: htmlToText(await readLimited(response)), failed: false };
    });
  } catch {
    return { text: null, failed: true };
  }
}

/** Люди с адресами со страниц самой компании и упоминаний её домена в открытом поиске. */
export async function collectCompanyPages(domain: string, deps: DossierDeps): Promise<CompanyPagesResult> {
  const pages: Array<{ url: string; text: string }> = [];
  let failed = false;
  if (!(await isPublicCompanyDomain(domain, deps))) return { samples: [], format: null, complete: true };
  for (const path of COMPANY_PAGE_PATHS) {
    const url = `https://${domain}${path}`;
    const page = await sitePage(url, deps);
    // Отказ сайта по частоте — остальные страницы не запрашиваем.
    if (page.failed) {
      failed = true;
      break;
    }
    if (page.text) pages.push({ url, text: page.text });
  }
  if (deps.exaApiKey) {
    try {
      const hits = await searchExaPages(`"@${domain}"`, deps.exaApiKey, AbortSignal.timeout(REQUEST_TIMEOUT_MS), {
        ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.requestGate ? { requestGate: deps.requestGate } : {}),
        numResults: EXA_PAGES,
        contents: { text: { maxCharacters: EXA_PAGE_CHARS } },
      });
      pages.push(...hits.map((hit) => ({ url: hit.url, text: hit.text })));
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
  const format = inferEmailFormat(samples);
  const example = format ? samples.find((sample) => formatsOf(sample).includes(format.id)) : undefined;
  return {
    samples,
    format: format && example ? { ...format, sourceUrl: example.sourceUrl } : null,
    complete: !failed,
  };
}

