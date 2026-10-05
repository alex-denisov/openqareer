import { createHash } from 'node:crypto';
import {
  FootprintSourceError,
  type FootprintAdapter,
  type FootprintFinding,
} from './footprintAdapter';
import { FootprintRequestGate, sharedFootprintRequestGate } from './requestScheduler';

const HIBP_API = 'https://haveibeenpwned.com/api/v3/breachedaccount/range/';
const SOURCE_NAME = 'Have I Been Pwned';
const MAX_RESPONSE_BYTES = 1_000_000;

export interface HibpAdapterInput {
  readonly email?: string;
}

export interface HibpAdapterOptions {
  readonly apiKey?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly requestGate?: FootprintRequestGate;
}

interface HibpRangeEntry {
  readonly hashSuffix?: unknown;
  readonly websites?: unknown;
}

function sourceError(message: string): FootprintSourceError {
  return new FootprintSourceError('hibp', 'source_error', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEmail(value: string | undefined): string {
  const email = value?.trim().normalize('NFC').toLowerCase() ?? '';
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw sourceError('Не удалось проверить формат почты для HIBP.');
  }
  return email;
}

function hashEmail(email: string): { prefix: string; suffix: string } {
  const digest = createHash('sha1').update(email, 'utf8').digest('hex').toUpperCase();
  return { prefix: digest.slice(0, 6), suffix: digest.slice(6) };
}

async function readResponseText(response: Response, signal: AbortSignal): Promise<string> {
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
        throw sourceError('Ответ HIBP превышает допустимый размер.');
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
  } catch (error) {
    if (error instanceof FootprintSourceError || signal.aborted) throw error;
    throw sourceError('Не удалось прочитать ответ HIBP.');
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

async function requestHashRange(
  prefix: string,
  apiKey: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
  requestGate: FootprintRequestGate,
): Promise<Response> {
  return requestGate.run('haveibeenpwned.com', signal, async () => {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    try {
      return await fetcher(`${HIBP_API}${prefix}`, {
        method: 'GET',
        redirect: 'error',
        headers: {
          'hibp-api-key': apiKey,
          'user-agent': 'OpenQareer digital footprint self-audit',
        },
        signal: requestSignal,
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw sourceError('Не удалось связаться с HIBP.');
    }
  });
}

function matchingBreachNames(payload: unknown, suffix: string): readonly string[] {
  if (!Array.isArray(payload) || payload.some((entry) =>
    !isRecord(entry) || typeof entry.hashSuffix !== 'string',
  )) throw sourceError('Ответ HIBP имеет неподдерживаемый формат.');
  const match = (payload as HibpRangeEntry[]).find(
    (entry) => typeof entry.hashSuffix === 'string' && entry.hashSuffix.toUpperCase() === suffix,
  );
  if (!match) return [];
  if (!Array.isArray(match.websites) || match.websites.some((name) => typeof name !== 'string')) {
    throw sourceError('Запись об утечке имеет неподдерживаемый формат.');
  }
  return match.websites
    .filter((name): name is string => Boolean(name.trim()))
    .map((name) => name.trim().slice(0, 120))
    .slice(0, 50);
}

function breachFinding(name: string, prefix: string, now: () => Date): FootprintFinding {
  return {
    adapter: 'hibp',
    kind: 'breach',
    url: null,
    title: name,
    detail: 'Адрес найден в записи об утечке; пароль не передавался.',
    match: 'likely_self',
    observedAt: now().toISOString(),
    receipt: {
      method: 'GET',
      source: SOURCE_NAME,
      query: `sha1-prefix=${prefix}`,
    },
  };
}

export function createHibpAdapter(options: HibpAdapterOptions): FootprintAdapter<HibpAdapterInput> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const requestGate = options.requestGate ?? sharedFootprintRequestGate;

  return {
    id: 'hibp',
    passive: true,
    async run(input, signal): Promise<readonly FootprintFinding[]> {
      if (!options.apiKey) {
        throw new FootprintSourceError('hibp', 'not_connected', 'Источник HIBP не подключён.');
      }
      if (signal.aborted) throw signal.reason;
      const emailHash = hashEmail(normalizeEmail(input.email));
      const response = await requestHashRange(
        emailHash.prefix,
        options.apiKey,
        signal,
        fetcher,
        requestGate,
      );
      if (!response.ok) {
        await discardResponseBody(response);
        throw sourceError('Источник HIBP не ответил успешно.');
      }
      const responseText = await readResponseText(response, signal);
      let payload: unknown;
      try {
        payload = JSON.parse(responseText);
      } catch {
        throw sourceError('Ответ HIBP имеет неподдерживаемый формат.');
      }
      if (signal.aborted) throw signal.reason;
      return matchingBreachNames(payload, emailHash.suffix).map((name) =>
        breachFinding(name, emailHash.prefix, now),
      );
    },
  };
}
