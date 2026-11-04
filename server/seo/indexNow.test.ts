import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIndexNowNotifier, INDEXNOW_URL_LIMIT } from './indexNow';

const ENDPOINTS = ['https://api.indexnow.org/indexnow', 'https://yandex.com/indexnow'];

interface LogEntry {
  level: 'info' | 'error';
  details: Record<string, unknown>;
  message: string;
}

function testLogger() {
  const entries: LogEntry[] = [];
  return {
    entries,
    info(details: Record<string, unknown>, message: string) {
      entries.push({ level: 'info', details, message });
    },
    error(details: Record<string, unknown>, message: string) {
      entries.push({ level: 'error', details, message });
    },
  };
}

const url = (path: string, lastmod?: string) => ({ path, ...(lastmod ? { lastmod } : {}) });
const created: DatabaseSync[] = [];

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  created.push(db);
  return db;
}

afterEach(() => {
  for (const db of created.splice(0)) db.close();
  vi.restoreAllMocks();
});

describe('IndexNow notifier', () => {
  it('logs one info line and stays disabled when the key is empty', async () => {
    const log = testLogger();
    const fetcher = vi.fn<typeof fetch>();
    const notify = createIndexNowNotifier('', log, fetcher);

    await notify(database(), [url('/vacancies/job/a', '2026-10-20')]);
    await notify(database(), [url('/vacancies/job/a', '2026-10-20')]);

    expect(log.entries).toEqual([
      { level: 'info', details: {}, message: 'indexnow-disabled-no-key' },
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends only added or changed URLs and forgets removals without submitting them', async () => {
    const log = testLogger();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 202 }));
    const notify = createIndexNowNotifier('a1b2c3d4e5f6a7b8', log, fetcher);
    const db = database();
    const original = [url('/vacancies/job/a', '2026-10-19'), url('/vacancies/job/b', '2026-10-19')];

    await notify(db, original);
    await notify(db, original);
    await notify(db, [original[0]!, url('/vacancies/job/b', '2026-10-20')]);
    await notify(db, [original[0]!]);
    await notify(db, original);

    const submitted = fetcher.mock.calls.map(
      ([, init]) =>
        JSON.parse(String(init?.body)) as {
          host: string;
          key: string;
          urlList: string[];
        },
    );
    const both = <T>(value: T) => [value, value];
    expect(submitted.map((payload) => payload.urlList)).toEqual([
      ...both(['https://openqareer.com/vacancies/job/a', 'https://openqareer.com/vacancies/job/b']),
      ...both(['https://openqareer.com/vacancies/job/b']),
      ...both(['https://openqareer.com/vacancies/job/b']),
    ]);
    expect(submitted[0]).toMatchObject({ host: 'openqareer.com', key: 'a1b2c3d4e5f6a7b8' });
    expect(fetcher.mock.calls.map(([input]) => input)).toEqual([
      ...ENDPOINTS,
      ...ENDPOINTS,
      ...ENDPOINTS,
    ]);
    // 03.11: a success is visible in the journal, per endpoint, with count and status.
    expect(log.entries.filter((entry) => entry.message === 'indexnow-submitted')[0]).toMatchObject({
      level: 'info',
      details: { endpoint: 'api.indexnow.org', urls: 2, statusCode: 202 },
    });
  });

  it('counts a batch as sent when one endpoint accepted it', async () => {
    const log = testLogger();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValue(new Response(null, { status: 200 }));
    const notify = createIndexNowNotifier('a1b2c3d4e5f6a7b8', log, fetcher);
    const db = database();
    const changed = [url('/vacancies/job/a', '2026-10-20')];

    await notify(db, changed);
    await notify(db, changed);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(log.entries.map((entry) => [entry.message, entry.details.endpoint])).toEqual([
      ['indexnow-submitted', 'api.indexnow.org'],
      ['indexnow-submit-failed', 'yandex.com'],
    ]);
  });

  it('splits requests at 10,000 URLs', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 200 }));
    const notify = createIndexNowNotifier('a1b2c3d4e5f6a7b8', testLogger(), fetcher);
    const urls = Array.from({ length: INDEXNOW_URL_LIMIT + 1 }, (_, index) =>
      url(`/vacancies/job/${index}`, '2026-10-20'),
    );

    await notify(database(), urls);

    const counts = fetcher.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { urlList: string[] };
      return body.urlList.length;
    });
    expect(counts).toEqual([10_000, 10_000, 1, 1]);
  });

  it('logs network and server failures, then retries them in the next cycle', async () => {
    const log = testLogger();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new TypeError('network down'));
    const notify = createIndexNowNotifier('a1b2c3d4e5f6a7b8', log, fetcher);
    const db = database();
    const changed = [url('/vacancies/job/a', '2026-10-20')];

    await expect(notify(db, changed)).resolves.toBeUndefined();
    await expect(notify(db, changed)).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledTimes(4);
    const errors = log.entries.filter((entry) => entry.level === 'error');
    expect(errors.map((entry) => entry.message)).toEqual(
      Array.from({ length: 4 }, () => 'indexnow-submit-failed'),
    );
    expect(errors[0]!.details).toMatchObject({
      endpoint: 'api.indexnow.org',
      errorName: 'TypeError',
    });
    expect(errors[1]!.details).toMatchObject({ endpoint: 'yandex.com', statusCode: 503, urls: 1 });
    expect(typeof errors[0]!.details.ms).toBe('number');
  });

  it('rejects invalid keys without logging or transmitting the key value', async () => {
    const log = testLogger();
    const fetcher = vi.fn<typeof fetch>();
    const notify = createIndexNowNotifier('not$aValidKey', log, fetcher);

    await notify(database(), [url('/vacancies/job/a', '2026-10-20')]);

    expect(fetcher).not.toHaveBeenCalled();
    expect(log.entries).toEqual([
      { level: 'error', details: {}, message: 'indexnow-disabled-invalid-key' },
    ]);
    expect(JSON.stringify(log.entries)).not.toContain('not$aValidKey');
  });
});
