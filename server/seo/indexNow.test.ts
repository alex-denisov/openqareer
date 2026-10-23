import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIndexNowNotifier, INDEXNOW_URL_LIMIT } from './indexNow';

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

    const submitted = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as {
      host: string;
      key: string;
      urlList: string[];
    });
    expect(submitted.map((payload) => payload.urlList)).toEqual([
      ['https://openqareer.com/vacancies/job/a', 'https://openqareer.com/vacancies/job/b'],
      ['https://openqareer.com/vacancies/job/b'],
      ['https://openqareer.com/vacancies/job/b'],
    ]);
    expect(submitted[0]).toMatchObject({ host: 'openqareer.com', key: 'a1b2c3d4e5f6a7b8' });
    expect(fetcher.mock.calls.every(([input]) => input === 'https://api.indexnow.org/indexnow')).toBe(true);
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
    expect(counts).toEqual([10_000, 1]);
  });

  it('logs network and server failures, then retries them in the next cycle', async () => {
    const log = testLogger();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const notify = createIndexNowNotifier('a1b2c3d4e5f6a7b8', log, fetcher);
    const db = database();
    const changed = [url('/vacancies/job/a', '2026-10-20')];

    await expect(notify(db, changed)).resolves.toBeUndefined();
    await expect(notify(db, changed)).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(log.entries.filter((entry) => entry.level === 'error')).toEqual([
      { level: 'error', details: { errorName: 'TypeError' }, message: 'indexnow-submit-failed' },
      {
        level: 'error',
        details: { statusCode: 503 },
        message: 'indexnow-submit-failed',
      },
    ]);
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
