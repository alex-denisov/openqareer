import { lookup as dnsLookup } from 'node:dns/promises';
import {
  Agent as HttpAgent,
  request as httpRequest,
  type Agent,
  type ClientRequest,
  type IncomingHttpHeaders,
  type IncomingMessage,
} from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { promisify } from 'node:util';
import { brotliDecompress, gunzip, inflate } from 'node:zlib';
import { isPublicAddress as defaultIsPublicAddress } from '../connectors/publicHost';

/**
 * B643: запрос рендера, выполняемый Node, а не браузером, чтобы проверка
 * адреса и соединение шли по одному и тому же ответу DNS (защита от DNS
 * rebinding). Свой `lookup` проверяет каждый адрес и отдаёт сокету только
 * проверенные; редиректы не выполняются, их разбирает вызывающий.
 */

export type ResolveAll = (
  host: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

export interface PinnedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: Buffer | null;
}

export interface PinnedResponse {
  readonly status: number;
  readonly headers: Record<string, string>;
  readonly body: Buffer;
}

export type PinnedFetch = (request: PinnedRequest) => Promise<PinnedResponse>;

export interface PinnedFetchOptions {
  readonly resolve?: ResolveAll;
  readonly isPublicAddress?: (address: string) => boolean;
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BODY_BYTES = 5 * 1024 * 1024;
/** Не передаются дальше: служебные заголовки соединения и сжатие (тело отдаётся браузеру распакованным). */
const DROPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'accept-encoding',
  'content-length',
  'upgrade',
]);
const DROPPED_RESPONSE_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'connection',
]);
const DECODERS: Record<string, (body: Buffer) => Promise<Buffer>> = {
  gzip: promisify(gunzip),
  deflate: promisify(inflate),
  br: promisify(brotliDecompress),
};

const defaultResolve: ResolveAll = (host) => dnsLookup(host, { all: true });

function pinnedLookup(resolve: ResolveAll, isPublic: (address: string) => boolean): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname).then(
      (addresses) => {
        if (addresses.length === 0 || !addresses.every(({ address }) => isPublic(address))) {
          callback(new Error('private_address'), '', 0);
          return;
        }
        if (options.all)
          callback(
            null,
            addresses.map((a) => ({ ...a })),
          );
        else callback(null, addresses[0]!.address, addresses[0]!.family);
      },
      (error: unknown) => callback(error instanceof Error ? error : new Error('dns_failed'), '', 0),
    );
  };
}

function outgoingHeaders(headers: Record<string, string>): Record<string, string> {
  const kept = Object.entries(headers).filter(
    ([name]) => !DROPPED_REQUEST_HEADERS.has(name.toLowerCase()),
  );
  return { ...Object.fromEntries(kept), 'accept-encoding': 'gzip, deflate, br' };
}

function flatHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name, value]) => value !== undefined && !DROPPED_RESPONSE_HEADERS.has(name))
      .map(([name, value]) => [name, Array.isArray(value) ? value.join('\n') : String(value)]),
  );
}

async function decode(body: Buffer, encoding: string | undefined): Promise<Buffer> {
  const decoder = encoding ? DECODERS[encoding.trim().toLowerCase()] : undefined;
  return decoder ? decoder(body) : body;
}

interface SendSettings {
  readonly lookup: LookupFunction;
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
  readonly agentFor: (protocol: string) => Agent | false;
  readonly track?: (request: ClientRequest) => void;
}

function readResponse(
  incoming: IncomingMessage,
  maxBodyBytes: number,
  resolve: (response: PinnedResponse) => void,
  reject: (error: Error) => void,
): void {
  const chunks: Buffer[] = [];
  let size = 0;
  incoming.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > maxBodyBytes) incoming.destroy(new Error('body_too_large'));
    else chunks.push(chunk);
  });
  incoming.on('error', reject);
  incoming.on('end', () => {
    decode(Buffer.concat(chunks), incoming.headers['content-encoding']).then(
      (body) =>
        resolve({ status: incoming.statusCode ?? 0, headers: flatHeaders(incoming.headers), body }),
      reject,
    );
  });
}

function sendPinned(request: PinnedRequest, settings: SendSettings): Promise<PinnedResponse> {
  return new Promise<PinnedResponse>((resolve, reject) => {
    const url = new URL(request.url);
    const send =
      url.protocol === 'https:' ? httpsRequest : url.protocol === 'http:' ? httpRequest : undefined;
    if (!send) return reject(new Error('unsupported_protocol'));
    // lookup идёт в каждое новое соединение, в том числе созданное агентом сессии.
    const outgoing = send(url, {
      method: request.method,
      headers: outgoingHeaders(request.headers),
      lookup: settings.lookup,
      agent: settings.agentFor(url.protocol),
      timeout: settings.timeoutMs,
    });
    settings.track?.(outgoing);
    outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')));
    outgoing.on('error', reject);
    outgoing.on('response', (incoming) =>
      readResponse(incoming, settings.maxBodyBytes, resolve, reject),
    );
    outgoing.end(request.body ?? undefined);
  });
}

function baseSettings(options: PinnedFetchOptions) {
  return {
    lookup: pinnedLookup(
      options.resolve ?? defaultResolve,
      options.isPublicAddress ?? defaultIsPublicAddress,
    ),
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBodyBytes: options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES,
  };
}

/** Одиночные запросы: каждое соединение новое. */
export function createPinnedFetch(options: PinnedFetchOptions = {}): PinnedFetch {
  const settings: SendSettings = { ...baseSettings(options), agentFor: () => false };
  return (request) => sendPinned(request, settings);
}

export interface PinnedSession {
  readonly fetch: PinnedFetch;
  /** Закрывает соединения и обрывает незавершённые запросы рендера. */
  close(): void;
}

/** Сокетов на хост, как у браузера: подресурсы идут параллельно. */
const SESSION_SOCKETS_PER_HOST = 6;

/**
 * B643: сессия одного рендера. Соединения держатся (keep-alive), поэтому
 * TLS к сайту устанавливается раз, а не на каждый подресурс. Сокет
 * привязан к адресу, проверенному в lookup при его открытии.
 */
export function createPinnedSession(options: PinnedFetchOptions = {}): PinnedSession {
  const agentOptions = { keepAlive: true, maxSockets: SESSION_SOCKETS_PER_HOST };
  const agents = { http: new HttpAgent(agentOptions), https: new HttpsAgent(agentOptions) };
  const open = new Set<ClientRequest>();
  const settings: SendSettings = {
    ...baseSettings(options),
    agentFor: (protocol) => (protocol === 'https:' ? agents.https : agents.http),
    track: (request) => {
      open.add(request);
      request.on('close', () => open.delete(request));
    },
  };
  return {
    fetch: (request) => sendPinned(request, settings),
    close: () => {
      for (const request of open) request.destroy(new Error('render_closed'));
      agents.http.destroy();
      agents.https.destroy();
    },
  };
}
