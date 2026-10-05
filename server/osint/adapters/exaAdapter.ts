import { isIP } from 'node:net';
import {
  FootprintSourceError,
  type FootprintAdapter,
  type FootprintFinding,
} from './footprintAdapter';
import { FootprintRequestGate, sharedFootprintRequestGate } from './requestScheduler';

const EXA_ENDPOINT = 'https://api.exa.ai/search';
const SOURCE_NAME = 'Exa';
const RESULTS_PER_QUERY = 5;
const MAX_RESPONSE_BYTES = 2_000_000;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE_PATTERN = /(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/gu;
const SECRET_PATTERN = /\b(?:sk-[A-Za-z0-9_-]{10,}|gh[pousr]_[A-Za-z0-9]{10,}|AKIA[A-Z0-9]{16}|Bearer\s+\S+)\b/gu;

export interface ExaAdapterInput {
  readonly fullName?: string;
  readonly photoUrl?: string;
  readonly employers?: readonly string[];
  readonly city?: string;
  readonly profileUrls?: readonly string[];
  readonly searchPeople?: boolean;
  readonly searchContext?: boolean;
}

export interface ExaAdapterOptions {
  readonly apiKey?: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly requestGate?: FootprintRequestGate;
}

interface ExaSearchResult {
  readonly title?: unknown;
  readonly url?: unknown;
  readonly image?: unknown;
  readonly highlights?: unknown;
  readonly text?: unknown;
}

function sourceError(message: string): FootprintSourceError {
  return new FootprintSourceError('exa', 'source_error', message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function queryText(input: ExaAdapterInput): { people: string; context: string } {
  const fullName = input.fullName?.trim().slice(0, 160) ?? '';
  if (!fullName) throw sourceError('Для поиска Exa нужно имя из профиля.');
  const context = [fullName, ...(input.employers ?? []).slice(0, 10), input.city]
    .map((value) => value?.trim().slice(0, 160) ?? '')
    .filter(Boolean)
    .join(' ');
  return { people: fullName, context };
}

function validResultUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (
      !['http:', 'https:'].includes(url.protocol) || isIP(url.hostname) !== 0 ||
      !url.hostname.includes('.') || url.username || url.password ||
      url.hostname.endsWith('.local') || url.hostname.endsWith('.localhost') ||
      url.hostname.endsWith('.internal') || (url.port && !['80', '443'].includes(url.port))
    ) return null;
    url.hash = '';
    return url;
  } catch {
    return null;
  }
}

function sanitizeText(value: string, maxLength: number): string {
  return value
    .replace(/<[^>]*>/gu, ' ')
    .replace(EMAIL_PATTERN, '[адрес скрыт]')
    .replace(PHONE_PATTERN, '[номер скрыт]')
    .replace(SECRET_PATTERN, '[секрет скрыт]')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, maxLength);
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
        throw sourceError('Ответ Exa превышает допустимый размер.');
      }
      chunks.push(decoder.decode(chunk.value, { stream: true }));
    }
  } catch (error) {
    if (error instanceof FootprintSourceError || signal.aborted) throw error;
    throw sourceError('Не удалось прочитать ответ Exa.');
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

/** Необязательные поля тела запроса; без них — прежнее поведение адаптера footprint. */
export interface ExaSearchOverrides {
  readonly numResults?: number;
  readonly includeDomains?: readonly string[];
  readonly contents?: Readonly<Record<string, unknown>>;
}

function searchBody(
  query: string,
  category: 'people' | undefined,
  overrides: ExaSearchOverrides,
): Record<string, unknown> {
  return {
    query,
    numResults: overrides.numResults ?? RESULTS_PER_QUERY,
    contents: overrides.contents ?? { highlights: true },
    ...(category ? { category } : {}),
    ...(overrides.includeDomains ? { includeDomains: overrides.includeDomains } : {}),
  };
}

async function runSearch(
  query: string,
  category: 'people' | undefined,
  apiKey: string,
  fetcher: typeof fetch,
  signal: AbortSignal,
  requestGate: FootprintRequestGate,
  overrides: ExaSearchOverrides = {},
): Promise<readonly ExaSearchResult[]> {
  const limit = overrides.numResults ?? RESULTS_PER_QUERY;
  return requestGate.run('api.exa.ai', signal, async () => {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
    const body = searchBody(query, category, overrides);
    let response: Response;
    try {
      response = await fetcher(EXA_ENDPOINT, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
        },
        body: JSON.stringify(body),
        signal: requestSignal,
      });
    } catch {
      if (signal.aborted) throw signal.reason;
      throw sourceError('Не удалось связаться с Exa.');
    }
    if (!response.ok) {
      await discardResponseBody(response);
      throw sourceError('Источник Exa не ответил успешно.');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(await readResponseText(response, signal));
    } catch (error) {
      if (error instanceof FootprintSourceError || signal.aborted) throw error;
      throw sourceError('Ответ Exa имеет неподдерживаемый формат.');
    }
    const results = isRecord(payload) ? payload.results : null;
    if (!Array.isArray(results) || results.some((result) => !isRecord(result))) {
      throw sourceError('Ответ Exa имеет неподдерживаемый формат.');
    }
    return results.slice(0, limit) as ExaSearchResult[];
  });
}

function normalized(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase('en-US');
}

function exactProfileMatch(input: ExaAdapterInput, url: URL): boolean {
  return (input.profileUrls ?? []).some((profileUrl) => {
    const candidateUrl = validResultUrl(profileUrl);
    return candidateUrl?.href === url.href;
  });
}

function exactPhotoMatch(input: ExaAdapterInput, result: ExaSearchResult): boolean {
  if (typeof result.image !== 'string' || !input.photoUrl) return false;
  const candidatePhoto = validResultUrl(input.photoUrl);
  const resultPhoto = validResultUrl(result.image);
  return Boolean(candidatePhoto && resultPhoto && candidatePhoto.href === resultPhoto.href);
}

function candidateContextMatched(text: string, input: ExaAdapterInput): boolean {
  const searchable = normalized(text);
  const contextTokens = [...(input.employers ?? []), input.city]
    .filter((value): value is string => Boolean(value?.trim()));
  return contextTokens.some((token) => searchable.includes(normalized(token)));
}

function exaFinding(
  result: ExaSearchResult,
  input: ExaAdapterInput,
  query: string,
  now: () => Date,
): FootprintFinding | null {
  if (typeof result.url !== 'string') return null;
  const url = validResultUrl(result.url);
  if (!url || /(^|\.)linkedin\.com$/iu.test(url.hostname)) return null;
  const sourceTitle = typeof result.title === 'string' ? result.title : '';
  const highlight = Array.isArray(result.highlights) && typeof result.highlights[0] === 'string'
    ? result.highlights[0]
    : typeof result.text === 'string' ? result.text : '';
  const candidateName = input.fullName?.trim() ?? '';
  const titleContainsName = candidateName && normalized(sourceTitle).includes(normalized(candidateName));
  const matchesProfileLink = exactProfileMatch(input, url);
  const matchesCandidateAsset = matchesProfileLink || exactPhotoMatch(input, result);
  const safeTitle = titleContainsName || matchesCandidateAsset
    ? sanitizeText(sourceTitle, 160)
    : url.hostname;
  const context = `${sourceTitle} ${highlight}`;
  const match = matchesCandidateAsset || (titleContainsName && candidateContextMatched(context, input))
    ? 'likely_self'
    : 'unknown';
  const safeExcerpt = match === 'likely_self'
    ? sanitizeText(highlight, 300)
    : 'Совпадение по имени не подтверждено; проверьте открытую страницу.';
  return {
    adapter: 'exa',
    kind: 'mention',
    url: url.href,
    title: safeTitle || url.hostname,
    detail: safeExcerpt,
    match,
    observedAt: now().toISOString(),
    receipt: { method: 'POST', source: SOURCE_NAME, query },
  };
}

export interface ExaPeopleHit {
  readonly url: string;
  readonly title: string;
  readonly text: string;
}

/** Поиск людей Exa через тот же транспорт, лимитер и лимит размера ответа, что у адаптера. */
export async function searchExaPeople(
  query: string,
  apiKey: string,
  signal: AbortSignal,
  options: { readonly fetch?: typeof fetch; readonly requestGate?: FootprintRequestGate } & ExaSearchOverrides,
): Promise<readonly ExaPeopleHit[]> {
  const { fetch: fetcher, requestGate, ...overrides } = options;
  const results = await runSearch(
    query,
    'people',
    apiKey,
    fetcher ?? globalThis.fetch,
    signal,
    requestGate ?? sharedFootprintRequestGate,
    overrides,
  );
  return results.flatMap((result) =>
    typeof result.url === 'string'
      ? [{
          url: result.url,
          title: typeof result.title === 'string' ? result.title : '',
          text: typeof result.text === 'string' ? result.text : '',
        }]
      : [],
  );
}

export function createExaAdapter(options: ExaAdapterOptions): FootprintAdapter<ExaAdapterInput> {
  const fetcher = options.fetch ?? globalThis.fetch;
  const now = options.now ?? (() => new Date());
  const requestGate = options.requestGate ?? sharedFootprintRequestGate;

  return {
    id: 'exa',
    passive: true,
    async run(input, signal): Promise<readonly FootprintFinding[]> {
      if (!options.apiKey) {
        throw new FootprintSourceError('exa', 'not_connected', 'Источник Exa не подключён.');
      }
      if (signal.aborted) throw signal.reason;
      const searchPeople = input.searchPeople ?? true;
      const searchContext = input.searchContext ?? true;
      if (!searchPeople && !searchContext) return [];
      const queries = queryText(input);
      const peopleResults = searchPeople
        ? await runSearch(queries.people, 'people', options.apiKey, fetcher, signal, requestGate)
        : [];
      const contextResults = searchContext
        ? await runSearch(queries.context, undefined, options.apiKey, fetcher, signal, requestGate)
        : [];
      return [
        ...peopleResults.map((result) => exaFinding(result, input, queries.people, now)),
        ...contextResults.map((result) => exaFinding(result, input, queries.context, now)),
      ].filter((finding): finding is FootprintFinding => finding !== null);
    },
  };
}
