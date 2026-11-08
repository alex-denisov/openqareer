import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, vi } from 'vitest';

/**
 * B622: тесты адаптеров читают записанные ответы площадок, а не сеть.
 * Перезапись: `RECORD_FIXTURES=1 npx vitest run <файл>` — ответы сохраняются
 * в `__fixtures__/recorded/<name>.json`. Без записи неизвестный адрес — ошибка,
 * а не тихий поход в интернет.
 */
interface RecordedResponse {
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
}

type Recording = Record<string, RecordedResponse>;

const MAX_BODY_CHARS = Number.MAX_SAFE_INTEGER;

function recordingPath(name: string): string {
  return join(__dirname, 'recorded', `${name}.json`);
}

function urlOf(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return String((input as { url?: string }).url ?? input);
}

export function useRecordedFetch(name: string): void {
  const recording = process.env.RECORD_FIXTURES === '1';
  const path = recordingPath(name);
  const realFetch = globalThis.fetch;
  const store: Recording =
    !recording && existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Recording) : {};

  beforeAll(() => {
    vi.stubGlobal('fetch', async (input: unknown, init?: RequestInit) => {
      const url = urlOf(input);
      if (recording) {
        const res = await realFetch(url, init);
        const body = (await res.text()).slice(0, MAX_BODY_CHARS);
        store[url] = {
          status: res.status,
          contentType: res.headers.get('content-type') ?? 'text/plain',
          body,
        };
        return new Response(body, {
          status: res.status,
          headers: { 'content-type': store[url]!.contentType },
        });
      }
      const hit = store[url];
      if (!hit) throw new Error(`recorded_fetch_missing: ${url}`);
      return new Response(hit.body, {
        status: hit.status,
        headers: { 'content-type': hit.contentType },
      });
    });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
    if (!recording) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(store, null, 0));
  });
}
