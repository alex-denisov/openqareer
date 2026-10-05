import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import {
  FootprintSourceError,
  type FootprintAdapter,
  type FootprintFinding,
} from './footprintAdapter';
import { FootprintRequestGate, sharedFootprintRequestGate } from './requestScheduler';

const CDX_ENDPOINT = 'https://web.archive.org/cdx/search/cdx';
const MAX_RESPONSE_BYTES = 2_000_000;
const MAX_CAPTURES = 20;
const PRIVATE_IPV4_RANGES = [
  ['0', 8], ['10', 8], ['100.64', 10], ['127', 8], ['169.254', 16],
  ['172.16', 12], ['192.0.0', 24], ['192.0.2', 24], ['192.88.99', 24],
  ['192.168', 16], ['198.18', 15], ['198.51.100', 24], ['203.0.113', 24],
] as const;

export interface WaybackAdapterInput {
  readonly profileUrl?: string;
}

export interface WaybackAdapterOptions {
  readonly fetch?: typeof fetch;
  readonly resolveHost?: (hostname: string) => Promise<readonly string[]>;
  readonly now?: () => Date;
  readonly requestGate?: FootprintRequestGate;
}

function sourceError(message: string): FootprintSourceError {
  return new FootprintSourceError('wayback', 'source_error', message);
}

function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null;
  return address.split('.').reduce((value, part) => value * 256 + Number(part), 0);
}

function inIpv4Range(address: string, prefix: string, bits: number): boolean {
  const value = ipv4Number(address);
  const base = ipv4Number(`${prefix.split('.')[0]}.${prefix.split('.')[1] ?? '0'}.${prefix.split('.')[2] ?? '0'}.${prefix.split('.')[3] ?? '0'}`);
  if (value === null || base === null) return false;
  const mask = bits === 0 ? 0 : (0xffff_ffff << (32 - bits)) >>> 0;
  return (value & mask) === (base & mask);
}

function isPublicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    return !PRIVATE_IPV4_RANGES.some(([prefix, bits]) => inIpv4Range(address, prefix, bits)) &&
      Number(address.split('.')[0]) < 224;
  }
  if (isIP(address) !== 6) return false;
  const value = address.toLowerCase().split('%')[0];
  const first = Number.parseInt(value.split(':')[0] || '0', 16);
  const second = Number.parseInt(value.split(':')[1] || '0', 16);
  return first >= 0x2000 && first <= 0x3fff &&
    !(first === 0x2001 && second <= 0x01ff) &&
    !(first === 0x3fff && second <= 0x0fff);
}

function normalizedPublicUrl(value: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(value ?? '');
  } catch {
    throw sourceError('Ссылка профиля имеет некорректный формат.');
  }
  const host = url.hostname.toLowerCase();
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username || url.password || isIP(host) !== 0 || !host.includes('.') ||
    host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal') ||
    (url.port && !['80', '443'].includes(url.port))
  ) {
    throw sourceError('Для архива принимаются только публичные ссылки HTTP или HTTPS.');
  }
  url.hash = '';
  return url;
}

async function resolvePublicHost(
  hostname: string,
  resolveHost: (hostname: string) => Promise<readonly string[]>,
  signal: AbortSignal,
): Promise<void> {
  let addresses: readonly string[];
  const lookupSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  let removeAbort: () => void = () => {};
  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectAbort = () => reject(lookupSignal.reason);
    if (lookupSignal.aborted) rejectAbort();
    else {
      lookupSignal.addEventListener('abort', rejectAbort, { once: true });
      removeAbort = () => lookupSignal.removeEventListener('abort', rejectAbort);
    }
  });
  try {
    addresses = await Promise.race([resolveHost(hostname), aborted]);
  } catch {
    if (signal.aborted) throw signal.reason;
    throw sourceError('Не удалось проверить публичный адрес профиля.');
  } finally {
    removeAbort();
  }
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address))) {
    throw sourceError('Ссылка профиля ведёт на локальный или непубличный адрес.');
  }
}

async function readLimitedText(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return chunks.join('') + decoder.decode();
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw sourceError('Ответ архива превышает допустимый размер.');
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
  } catch (error) {
    if (error instanceof FootprintSourceError || signal.aborted) throw error;
    throw sourceError('Не удалось прочитать ответ архива.');
  } finally {
    reader.releaseLock();
  }
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ошибка закрытия тела не меняет результат проверки источника.
  }
}

async function requestCdx(
  originalUrl: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  requestGate: FootprintRequestGate,
): Promise<Response> {
  const endpoint = new URL(CDX_ENDPOINT);
  endpoint.searchParams.set('url', originalUrl);
  endpoint.searchParams.set('output', 'json');
  endpoint.searchParams.set('fl', 'timestamp,original,statuscode');
  endpoint.searchParams.set('filter', 'statuscode:200');
  endpoint.searchParams.set('limit', String(MAX_CAPTURES));
  return requestGate.run('web.archive.org', signal, async () => {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    try {
      return await fetcher(endpoint.href, {
        method: 'GET',
        redirect: 'error',
        headers: { accept: 'application/json' },
        signal: requestSignal,
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw sourceError('Не удалось связаться с архивом.');
    }
  });
}

function parseCaptures(payload: unknown, originalUrl: string): readonly { timestamp: string }[] {
  if (!Array.isArray(payload)) {
    throw sourceError('Ответ архива имеет неподдерживаемый формат.');
  }
  if (!payload.length) return [];
  if (!Array.isArray(payload[0])) throw sourceError('Ответ архива имеет неподдерживаемый формат.');
  const headers = payload[0] as string[];
  if (headers.some((header) => typeof header !== 'string') || payload.slice(1).some((row) => !Array.isArray(row))) {
    throw sourceError('Ответ архива имеет неподдерживаемый формат.');
  }
  const timestampIndex = headers.indexOf('timestamp');
  const originalIndex = headers.indexOf('original');
  const statusIndex = headers.indexOf('statuscode');
  if (timestampIndex < 0 || originalIndex < 0 || statusIndex < 0) {
    throw sourceError('Ответ архива не содержит поля снимка.');
  }
  return payload.slice(1).flatMap((row: unknown) => {
    if (!Array.isArray(row)) throw sourceError('Строка снимка архива имеет неподдерживаемый формат.');
    const timestamp = row[timestampIndex];
    const original = row[originalIndex];
    const status = row[statusIndex];
    if ([timestamp, original, status].some((value) => typeof value !== 'string')) {
      throw sourceError('Строка снимка архива имеет неподдерживаемый формат.');
    }
    if (
      typeof timestamp !== 'string' || !/^\d{14}$/u.test(timestamp) ||
      original !== originalUrl || status !== '200'
    ) return [];
    return [{ timestamp }];
  });
}

function archiveFinding(
  timestamp: string,
  originalUrl: string,
  now: () => Date,
): FootprintFinding {
  const archiveUrl = `https://web.archive.org/web/${timestamp}/${originalUrl}`;
  return {
    adapter: 'wayback',
    kind: 'archive',
    url: archiveUrl,
    title: 'Архивная копия профиля',
    detail: `В архиве найден снимок от ${timestamp.slice(0, 4)}-${timestamp.slice(4, 6)}-${timestamp.slice(6, 8)}.`,
    match: 'likely_self',
    observedAt: now().toISOString(),
    receipt: {
      method: 'GET',
      source: 'Internet Archive CDX',
      query: `url=${originalUrl}`,
    },
  };
}

export function createWaybackAdapter(
  options: WaybackAdapterOptions = {},
): FootprintAdapter<WaybackAdapterInput> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const resolveHost = options.resolveHost ?? (async (hostname: string) =>
    (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) => address));
  const now = options.now ?? (() => new Date());
  const requestGate = options.requestGate ?? sharedFootprintRequestGate;

  return {
    id: 'wayback',
    passive: true,
    async run(input, signal): Promise<readonly FootprintFinding[]> {
      if (signal.aborted) throw signal.reason;
      const profileUrl = normalizedPublicUrl(input.profileUrl);
      await resolvePublicHost(profileUrl.hostname, resolveHost, signal);
      const response = await requestCdx(profileUrl.href, signal, fetcher, requestGate);
      if (!response.ok) {
        await discardResponseBody(response);
        throw sourceError('Архив не ответил успешно.');
      }
      let payload: unknown;
      try {
        payload = JSON.parse(await readLimitedText(response, signal));
      } catch (error) {
        if (error instanceof FootprintSourceError || signal.aborted) throw error;
        throw sourceError('Ответ архива имеет неподдерживаемый формат.');
      }
      if (signal.aborted) throw signal.reason;
      return parseCaptures(payload, profileUrl.href).map(({ timestamp }) =>
        archiveFinding(timestamp, profileUrl.href, now),
      );
    },
  };
}
