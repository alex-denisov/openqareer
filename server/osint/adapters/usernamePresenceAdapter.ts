import { isIP } from 'node:net';
import {
  FootprintSourceError,
  type FootprintAdapter,
  type FootprintFinding,
} from './footprintAdapter';
import { getCuratedMaigretSite, isCuratedMaigretSite } from './maigretSiteCatalogue';
import { FootprintRequestGate, sharedFootprintRequestGate } from './requestScheduler';

const REQUEST_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 1_000_000;

export interface UsernamePresenceSite {
  readonly name: string;
  readonly url: string;
  readonly checkType: 'message' | 'status_code';
  readonly presenseStrs?: readonly string[];
  readonly absenceStrs?: readonly string[];
}

export interface UsernamePresenceInput {
  readonly username: string;
}

export interface UsernamePresenceOptions {
  readonly site: UsernamePresenceSite;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly requestGate?: FootprintRequestGate;
}

function sourceError(sourceId: string, message: string): FootprintSourceError {
  return new FootprintSourceError(sourceId, 'source_error', message);
}

function isPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return Boolean(
    host.includes('.') &&
      !host.endsWith('.local') &&
      !host.endsWith('.localhost') &&
      !host.endsWith('.internal') &&
      isIP(host) === 0,
  );
}

function profileUrl(site: UsernamePresenceSite, username: string): URL {
  if (!isCuratedMaigretSite(site)) {
    throw sourceError(site.name, 'Источник отсутствует в проверенном списке сайтов.');
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/u.test(username)) {
    throw sourceError(site.name, 'Имя пользователя не подходит для проверки источника.');
  }
  if (!site.url.includes('{username}') || site.url.length > 2_048) {
    throw sourceError(site.name, 'Шаблон публичного профиля не поддерживается.');
  }
  let parsed: URL;
  try {
    parsed = new URL(site.url.replaceAll('{username}', encodeURIComponent(username)));
  } catch {
    throw sourceError(site.name, 'Шаблон публичного профиля некорректен.');
  }
  if (
    parsed.protocol !== 'https:' ||
    !isPublicHost(parsed.hostname) ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443')
  ) {
    throw sourceError(site.name, 'Источник не прошёл проверку публичного HTTPS-адреса.');
  }
  return parsed;
}

async function readLimitedText(response: Response, site: string): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) return text + decoder.decode();
      total += chunk.value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw sourceError(site, 'Ответ источника превышает допустимый размер.');
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } catch (error) {
    if (error instanceof FootprintSourceError) throw error;
    throw sourceError(site, 'Не удалось прочитать ответ источника.');
  } finally {
    reader.releaseLock();
  }
}

function hasPresenceSignal(site: UsernamePresenceSite, body: string): boolean {
  if (site.checkType === 'status_code') return true;
  if (site.absenceStrs?.some((marker) => body.includes(marker))) return false;
  if (!site.presenseStrs?.length) return Boolean(site.absenceStrs?.length);
  return site.presenseStrs.some((marker) => body.includes(marker));
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Ошибка закрытия тела не меняет результат проверки источника.
  }
}

async function requestProfile(
  url: URL,
  signal: AbortSignal,
  fetcher: typeof fetch,
  requestGate: FootprintRequestGate,
  sourceId: string,
): Promise<Response> {
  return requestGate.run(url.hostname, signal, async () => {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    try {
      return await fetcher(url.href, {
        method: 'GET',
        redirect: 'manual',
        headers: { accept: 'text/html,application/xhtml+xml' },
        signal: requestSignal,
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw sourceError(sourceId, 'Не удалось проверить открытый профиль.');
    }
  });
}

export function createUsernamePresenceAdapter(
  id: 'sherlock' | 'maigret',
  options: UsernamePresenceOptions,
): FootprintAdapter<UsernamePresenceInput> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const requestGate = options.requestGate ?? sharedFootprintRequestGate;

  return {
    id,
    passive: true,
    run: (input, signal) => runUsernamePresence(id, options, input, signal, fetcher, now, requestGate),
  };
}

async function runUsernamePresence(
  id: 'sherlock' | 'maigret',
  options: UsernamePresenceOptions,
  input: UsernamePresenceInput,
  signal: AbortSignal,
  fetcher: typeof fetch,
  now: () => Date,
  requestGate: FootprintRequestGate,
): Promise<readonly FootprintFinding[]> {
  if (signal.aborted) throw signal.reason;
  if (getCuratedMaigretSite(options.site.name)?.adapterId !== id) {
    throw sourceError(options.site.name, 'Источник закреплён за другим списком профилей.');
  }
  const url = profileUrl(options.site, input.username);
  const response = await requestProfile(url, signal, fetcher, requestGate, options.site.name);
  if (response.status >= 300 && response.status < 400) {
    await discardResponseBody(response);
    throw sourceError(options.site.name, 'Источник перенаправил запрос; результат не подтверждён.');
  }
  if (response.status === 404 || response.status === 410) {
    await discardResponseBody(response);
    return [];
  }
  if (!response.ok) {
    await discardResponseBody(response);
    throw sourceError(options.site.name, 'Источник не ответил успешно.');
  }
  const body = options.site.checkType === 'message'
    ? await readLimitedText(response, options.site.name)
    : '';
  if (options.site.checkType === 'status_code') await discardResponseBody(response);
  if (!hasPresenceSignal(options.site, body)) return [];
  return [presenceFinding(id, options.site, input.username, url, now)];
}

function presenceFinding(
  id: 'sherlock' | 'maigret',
  site: UsernamePresenceSite,
  username: string,
  url: URL,
  now: () => Date,
): FootprintFinding {
  return {
    adapter: id,
    kind: 'profile',
    url: url.href,
    title: site.name,
    detail: 'Открытая страница найдена по нику; владение нужно подтвердить.',
    match: 'likely_self',
    observedAt: now().toISOString(),
    receipt: { method: 'GET', source: site.name, query: `username=${username}` },
  };
}
