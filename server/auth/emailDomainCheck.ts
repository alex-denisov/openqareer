import { promises as dns } from 'node:dns';

export const DEFAULT_MX_CHECK_BYPASS_DOMAINS = [
  'example.com',
  'example.org',
  'example.net',
  'test',
] as const;

export type EmailDomainCheckStatus = 'bypassed' | 'reachable' | 'unreachable' | 'unavailable';

export interface EmailDomainResolver {
  resolveMx(domain: string): Promise<readonly { exchange: string; priority: number }[]>;
  resolve4(domain: string): Promise<readonly string[]>;
  resolve6(domain: string): Promise<readonly string[]>;
}

export interface EmailDomainDnsFailure {
  code: string;
}

interface EmailDomainCheckOptions {
  resolver?: EmailDomainResolver;
  bypassDomains: readonly string[];
  onDnsFailure?: (failure: EmailDomainDnsFailure) => void;
  now?: () => number;
  timeoutMs?: number;
  maxCacheEntries?: number;
}

interface CachedResult {
  status: 'reachable' | 'unreachable';
  expiresAt: number;
}

type DomainResolution =
  | { status: 'reachable' }
  | { status: 'unreachable' }
  | { status: 'unavailable'; code: string };
type AddressResolution = DomainResolution | { status: 'no-data' };

const POSITIVE_CACHE_TTL_MS = 60 * 60 * 1_000;
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_CACHE_ENTRIES = 1_000;
const NO_DATA_CODES = new Set(['ENODATA', 'ENORECORDS']);
const NAME_NOT_FOUND_CODES = new Set(['ENOTFOUND']);

const systemResolver: EmailDomainResolver = {
  resolveMx: (domain) => dns.resolveMx(domain),
  resolve4: (domain) => dns.resolve4(domain),
  resolve6: (domain) => dns.resolve6(domain),
};

export function createEmailDomainChecker(
  options: EmailDomainCheckOptions,
): (email: string) => Promise<EmailDomainCheckStatus> {
  const resolver = options.resolver ?? systemResolver;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxCacheEntries = Math.max(0, options.maxCacheEntries ?? DEFAULT_MAX_CACHE_ENTRIES);
  const bypassDomains = options.bypassDomains.map(normalizeDomain).filter(Boolean);
  const onDnsFailure = options.onDnsFailure ?? writeDnsFailure;
  const cache = new Map<string, CachedResult>();

  return async (email: string): Promise<EmailDomainCheckStatus> => {
    const domain = emailDomain(email);
    if (!domain) return 'unreachable';
    if (isBypassed(domain, bypassDomains)) return 'bypassed';

    const cached = cache.get(domain);
    if (cached && cached.expiresAt > now()) return cached.status;
    if (cached) cache.delete(domain);

    const deadline = now() + timeoutMs;
    const result = await resolveDomain(domain, resolver, deadline, now);
    if (result.status === 'unavailable') {
      onDnsFailure({ code: result.code });
      return result.status;
    }
    storeResult(cache, domain, result.status, now(), maxCacheEntries);
    return result.status;
  };
}

async function resolveDomain(
  domain: string,
  resolver: EmailDomainResolver,
  deadline: number,
  now: () => number,
): Promise<DomainResolution> {
  let mx: readonly { exchange: string; priority: number }[];
  try {
    mx = await resolveWithTimeout(resolver.resolveMx(domain), deadline, now);
  } catch (error) {
    const code = errorCode(error);
    if (NAME_NOT_FOUND_CODES.has(code)) return { status: 'unreachable' };
    if (!NO_DATA_CODES.has(code)) return { status: 'unavailable', code };
    mx = [];
  }
  if (mx.length > 0) {
    return {
      status: mx.some((record) => record.exchange !== '.') ? 'reachable' : 'unreachable',
    };
  }

  const ipv4 = await addressResult(resolver.resolve4(domain), deadline, now);
  if (ipv4.status !== 'no-data') return ipv4;
  const ipv6 = await addressResult(resolver.resolve6(domain), deadline, now);
  return ipv6.status === 'no-data' ? { status: 'unreachable' } : ipv6;
}

async function addressResult(
  lookup: Promise<readonly string[]>,
  deadline: number,
  now: () => number,
): Promise<AddressResolution> {
  try {
    return {
      status: (await resolveWithTimeout(lookup, deadline, now)).length > 0 ? 'reachable' : 'no-data',
    };
  } catch (error) {
    const code = errorCode(error);
    if (NO_DATA_CODES.has(code)) return { status: 'no-data' };
    if (NAME_NOT_FOUND_CODES.has(code)) return { status: 'unreachable' };
    return { status: 'unavailable', code };
  }
}

async function resolveWithTimeout<Value>(
  lookup: Promise<Value>,
  deadline: number,
  now: () => number,
): Promise<Value> {
  const remainingMs = deadline - now();
  if (remainingMs <= 0) throw timeoutError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      lookup,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(timeoutError()), remainingMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function storeResult(
  cache: Map<string, CachedResult>,
  domain: string,
  status: 'reachable' | 'unreachable',
  now: number,
  maxEntries: number,
): void {
  if (maxEntries === 0) return;
  if (!cache.has(domain) && cache.size >= maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(domain, {
    status,
    expiresAt: now + (status === 'reachable' ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
  });
}

function emailDomain(email: string): string {
  const separator = email.lastIndexOf('@');
  return separator < 0 ? '' : normalizeDomain(email.slice(separator + 1));
}

function normalizeDomain(domain: string): string {
  return domain.trim().toLowerCase().replace(/\.+$/u, '');
}

function isBypassed(domain: string, bypassDomains: readonly string[]): boolean {
  return bypassDomains.some((bypass) => domain === bypass || domain.endsWith(`.${bypass}`));
}

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string' && code.length > 0) return code;
  }
  return error instanceof Error && error.name === 'EmailDomainCheckTimeoutError'
    ? 'DNS_TIMEOUT'
    : 'DNS_ERROR';
}

function timeoutError(): Error {
  const error = new Error('email domain DNS check timed out');
  error.name = 'EmailDomainCheckTimeoutError';
  return error;
}

function writeDnsFailure(failure: EmailDomainDnsFailure): void {
  process.stdout.write(
    `${JSON.stringify({
      level: 40,
      time: Date.now(),
      event: 'email_domain_dns_unavailable',
      errorCode: failure.code,
    })}\n`,
  );
}
