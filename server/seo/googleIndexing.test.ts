import { generateKeyPairSync } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createGoogleIndexingNotifier,
  GOOGLE_INDEXING_DAILY_BUDGET,
  GOOGLE_INDEXING_ENDPOINT,
} from './googleIndexing';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const KEY = Buffer.from(
  JSON.stringify({
    client_email: 'bot@proj.iam.gserviceaccount.com',
    private_key: PEM,
  }),
).toString('base64');
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// 20:00 UTC = noon in Los Angeles: more than half of the daily budget is open.
const NOON = new Date('2026-11-04T20:00:00Z');
// 07:55 UTC on the 5th = 23:55 on the 4th in Los Angeles: all of it is open.
const LATE = new Date('2026-11-05T07:55:00Z');
const HOUR_MS = 3_600_000;

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

const job = (slug: string, lastmod = '2026-11-01') => ({
  path: `/vacancies/job/${slug}`,
  lastmod,
});
const absolute = (slug: string) => `https://openqareer.com/vacancies/job/${slug}`;
const created: DatabaseSync[] = [];

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  created.push(db);
  return db;
}

type Publish = (url: string, type: string) => number;

/** Google's two hosts behind one fetch; `publish` picks the status per notification. */
function google(publish: Publish = () => 200) {
  const published: Array<{ url: string; type: string; auth: string | null }> = [];
  const assertions: string[] = [];
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    if (String(input) === TOKEN_URL) {
      assertions.push(new URLSearchParams(String(init?.body)).get('assertion') ?? '');
      return Response.json({ access_token: 'token-1', expires_in: 3600 });
    }
    expect(String(input)).toBe(GOOGLE_INDEXING_ENDPOINT);
    const body = JSON.parse(String(init?.body)) as { url: string; type: string };
    const auth = new Headers(init?.headers).get('authorization');
    published.push({ ...body, auth });
    return new Response('{}', { status: publish(body.url, body.type) });
  });
  return { fetcher, published, assertions };
}

function notifierAt(log: ReturnType<typeof testLogger>, fetcher: typeof fetch) {
  const clock = { now: NOON };
  const notify = createGoogleIndexingNotifier(KEY, log, fetcher, () => clock.now);
  return { notify, clock };
}

afterEach(() => {
  for (const db of created.splice(0)) db.close();
});

describe('Google Indexing API notifier', () => {
  it('logs the failing step, a bounded message and the cause code', async () => {
    const log = testLogger();
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } });
    });
    const { notify } = notifierAt(log, fetcher);

    await notify(database(), [job('a')]);

    expect(log.entries).toEqual([
      {
        level: 'error',
        message: 'google-indexing-failed',
        details: {
          errorName: 'TypeError',
          step: 'token',
          message: 'fetch failed',
          causeCode: 'ECONNRESET',
        },
      },
    ]);
  });

  it('never logs the key, the token or the assertion from an error message', async () => {
    const secrets = [
      PEM,
      KEY,
      'ya29.a0AfB_byC-secret-access-token',
      'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJib3QifQ.c2lnbmF0dXJl',
    ];
    for (const secret of secrets) {
      const log = testLogger();
      const fetcher = vi.fn<typeof fetch>(async () => {
        throw new Error(`request failed: Bearer ${secret} assertion=${secret} ${'x '.repeat(200)}`);
      });
      const { notify } = notifierAt(log, fetcher);

      await notify(database(), [job('a')]);

      const written = JSON.stringify(log.entries);
      for (const part of secret.split('\n').filter((line) => line.length > 8)) {
        expect(written).not.toContain(part);
      }
      expect(String(log.entries[0]?.details.message).length).toBeLessThanOrEqual(200);
    }
  });

  it('names the cycle step when the failure is not the token', async () => {
    const log = testLogger();
    const { fetcher } = google();
    const { notify } = notifierAt(log, fetcher);
    const closed = new DatabaseSync(':memory:');
    closed.close();

    await notify(closed, [job('a')]);

    expect(log.entries[0]).toMatchObject({
      level: 'error',
      message: 'google-indexing-failed',
      details: { step: 'cycle', message: expect.any(String) },
    });
    expect(log.entries[0]?.details).not.toHaveProperty('causeCode');
  });

  it('logs one line and stays off without a key', async () => {
    const log = testLogger();
    const { fetcher } = google();
    const notify = createGoogleIndexingNotifier('', log, fetcher);

    await notify(database(), [job('a')]);
    await notify(database(), [job('a')]);

    expect(log.entries).toEqual([
      { level: 'info', details: {}, message: 'google-indexing-disabled-no-key' },
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('stays off on a key that is not a service account, without echoing it', async () => {
    const log = testLogger();
    const { fetcher } = google();
    const bad = Buffer.from('{"private_key":"secret-value"}').toString('base64');
    const notify = createGoogleIndexingNotifier(bad, log, fetcher);

    await notify(database(), [job('a')]);

    expect(log.entries.map((entry) => entry.message)).toEqual(['google-indexing-disabled-bad-key']);
    expect(JSON.stringify(log.entries)).not.toContain('secret-value');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('asks for the indexing scope and sends URL_UPDATED for cards only, in queue order', async () => {
    const log = testLogger();
    const { fetcher, published, assertions } = google();
    const { notify } = notifierAt(log, fetcher);

    await notify(database(), [
      job('new'),
      { path: '/vacancies/moscow', lastmod: '2026-11-01' },
      { path: '/about' },
      job('old', '2026-10-01'),
    ]);

    expect(published).toEqual([
      { url: absolute('new'), type: 'URL_UPDATED', auth: 'Bearer token-1' },
      { url: absolute('old'), type: 'URL_UPDATED', auth: 'Bearer token-1' },
    ]);
    const claims = JSON.parse(
      Buffer.from(assertions[0]?.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { scope: string; iss: string };
    expect(claims).toMatchObject({
      scope: 'https://www.googleapis.com/auth/indexing',
      iss: 'bot@proj.iam.gserviceaccount.com',
    });
    expect(log.entries.at(-1)).toMatchObject({
      level: 'info',
      message: 'google-indexing-cycle',
      details: { updated: 2, deleted: 0, sentToday: 2, budget: GOOGLE_INDEXING_DAILY_BUDGET },
    });
  });

  it('does not repeat a notification, across cycles and across a restart', async () => {
    const log = testLogger();
    const { fetcher, published } = google();
    const db = database();

    await notifierAt(log, fetcher).notify(db, [job('a')]);
    await notifierAt(log, fetcher).notify(db, [job('a')]);

    expect(published).toHaveLength(1);
  });

  it('notifies again when the posting got a newer date, not an older one', async () => {
    const log = testLogger();
    const { fetcher, published } = google();
    const { notify } = notifierAt(log, fetcher);
    const db = database();

    await notify(db, [job('a', '2026-11-01')]);
    await notify(db, [job('a', '2026-10-20')]);
    expect(published).toHaveLength(1);

    await notify(db, [job('a', '2026-11-03')]);
    expect(published).toHaveLength(2);
  });

  it('never spends more than the daily budget, and a restart does not reset it', async () => {
    const log = testLogger();
    const { fetcher, published } = google();
    const db = database();
    const cards = Array.from({ length: GOOGLE_INDEXING_DAILY_BUDGET + 50 }, (_, i) => job(`c${i}`));

    const first = createGoogleIndexingNotifier(KEY, log, fetcher, () => LATE);
    await first(db, cards);
    expect(published).toHaveLength(GOOGLE_INDEXING_DAILY_BUDGET);

    const restarted = createGoogleIndexingNotifier(KEY, log, fetcher, () => LATE);
    await restarted(db, cards);
    expect(published).toHaveLength(GOOGLE_INDEXING_DAILY_BUDGET);

    // The Pacific day turned: the queue moves on from where it stopped.
    const nextDay = createGoogleIndexingNotifier(
      KEY,
      log,
      fetcher,
      () => new Date('2026-11-05T09:00:00Z'),
    );
    await nextDay(db, cards);
    expect(published.length).toBeGreaterThan(GOOGLE_INDEXING_DAILY_BUDGET);
    expect(published.at(GOOGLE_INDEXING_DAILY_BUDGET)?.url).toBe(
      absolute(`c${GOOGLE_INDEXING_DAILY_BUDGET}`),
    );
  });

  it('paces the budget over the day, so a card posted in the evening is not a day late', async () => {
    const log = testLogger();
    const { fetcher, published } = google();
    const db = database();
    const cards = Array.from({ length: GOOGLE_INDEXING_DAILY_BUDGET }, (_, i) => job(`c${i}`));

    // 08:10 UTC = 00:10 in Los Angeles.
    const notify = createGoogleIndexingNotifier(
      KEY,
      log,
      fetcher,
      () => new Date('2026-11-05T08:10:00Z'),
    );
    await notify(db, cards);

    expect(published.length).toBeGreaterThan(0);
    expect(published.length).toBeLessThan(GOOGLE_INDEXING_DAILY_BUDGET / 10);
  });

  it('stops at the first 429 and asks nothing more until the next Pacific day', async () => {
    const log = testLogger();
    const { fetcher, published } = google((url) => (url.endsWith('/b') ? 429 : 200));
    const clock = { now: NOON };
    const notify = createGoogleIndexingNotifier(KEY, log, fetcher, () => clock.now);
    const db = database();
    const cards = [job('a'), job('b'), job('c')];

    await notify(db, cards);
    expect(published.map((item) => item.url)).toEqual([absolute('a'), absolute('b')]);
    expect(log.entries.at(-1)?.details).toMatchObject({ updated: 1, quotaExhausted: true });

    fetcher.mockClear();
    clock.now = new Date(NOON.getTime() + HOUR_MS);
    await notify(db, cards);
    expect(fetcher).not.toHaveBeenCalled();

    clock.now = new Date('2026-11-05T20:00:00Z');
    await notify(db, cards);
    // The mock still answers 429 for `b`, so the queue resumes at it and stops there again.
    expect(published.map((item) => item.url).slice(2)).toEqual([absolute('b')]);
  });

  it('survives a 429 across a restart', async () => {
    const log = testLogger();
    const { fetcher } = google(() => 429);
    const db = database();

    await notifierAt(log, fetcher).notify(db, [job('a')]);
    fetcher.mockClear();
    await notifierAt(log, fetcher).notify(db, [job('a')]);

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('sends URL_DELETED only after a card has been gone from the sitemap for a day', async () => {
    const log = testLogger();
    const { fetcher, published } = google();
    const { notify, clock } = notifierAt(log, fetcher);
    const db = database();

    await notify(db, [job('a'), job('b')]);
    published.length = 0;

    await notify(db, [job('b')]);
    clock.now = new Date(NOON.getTime() + 23 * HOUR_MS);
    await notify(db, [job('b')]);
    expect(published).toEqual([]);

    clock.now = new Date(NOON.getTime() + 25 * HOUR_MS);
    await notify(db, [job('b')]);
    expect(published.map(({ url, type }) => ({ url, type }))).toEqual([
      { url: absolute('a'), type: 'URL_DELETED' },
    ]);

    clock.now = new Date(NOON.getTime() + 26 * HOUR_MS);
    await notify(db, [job('b')]);
    expect(published).toHaveLength(1);
  });

  it('a card back in the sitemap within the day costs nothing', async () => {
    const log = testLogger();
    const { fetcher, published } = google();
    const { notify, clock } = notifierAt(log, fetcher);
    const db = database();

    await notify(db, [job('a'), job('b')]);
    published.length = 0;

    await notify(db, [job('b')]);
    clock.now = new Date(NOON.getTime() + HOUR_MS);
    await notify(db, [job('a'), job('b')]);
    clock.now = new Date(NOON.getTime() + 30 * HOUR_MS);
    await notify(db, [job('a'), job('b')]);

    expect(published).toEqual([]);
  });

  it('spends nothing on a card that was never notified', async () => {
    const log = testLogger();
    const { fetcher, published } = google();
    const { notify, clock } = notifierAt(log, fetcher);
    const db = database();

    await notify(db, [job('b')]);
    clock.now = new Date(NOON.getTime() + 48 * HOUR_MS);
    await notify(db, [job('b')]);

    expect(published.map((item) => item.url)).toEqual([absolute('b')]);
  });

  it('treats an empty card list as a failed read, not as every card removed', async () => {
    const log = testLogger();
    const { fetcher, published } = google();
    const { notify, clock } = notifierAt(log, fetcher);
    const db = database();

    await notify(db, [job('a')]);
    published.length = 0;

    await notify(db, []);
    clock.now = new Date(NOON.getTime() + 48 * HOUR_MS);
    await notify(db, []);

    expect(published).toEqual([]);
  });

  it('a backlog of new cards does not starve removals', async () => {
    const log = testLogger();
    const { fetcher, published } = google();
    const clock = { now: new Date('2026-11-04T08:30:00Z') };
    const notify = createGoogleIndexingNotifier(KEY, log, fetcher, () => clock.now);
    const db = database();
    const old = Array.from({ length: 4 }, (_, i) => job(`old${i}`));
    await notify(db, old);
    const fresh = Array.from({ length: 500 }, (_, i) => job(`new${i}`));

    await notify(db, fresh); // marks the old cards as gone
    clock.now = new Date('2026-11-05T08:40:00Z'); // the next Pacific day, its first half hour
    published.length = 0;
    await notify(db, fresh);

    const types = published.map((item) => item.type);
    expect(types.filter((type) => type === 'URL_DELETED').length).toBeGreaterThan(0);
    expect(types.filter((type) => type === 'URL_UPDATED').length).toBeGreaterThan(0);
    expect(types[0]).toBe('URL_UPDATED');
  });

  it('a server error stops the cycle and the same card is tried on the next one', async () => {
    const log = testLogger();
    let status = 503;
    const { fetcher, published } = google(() => status);
    const { notify } = notifierAt(log, fetcher);
    const db = database();

    await notify(db, [job('a'), job('b')]);
    expect(published).toHaveLength(1);
    expect(log.entries.map((entry) => entry.message)).toContain('google-indexing-send-failed');

    status = 200;
    published.length = 0;
    await notify(db, [job('a'), job('b')]);
    expect(published.map((item) => item.url)).toEqual([absolute('a'), absolute('b')]);
  });

  it('a 403 stops the cycle: the key has no rights, the next card would fail too', async () => {
    const log = testLogger();
    const { fetcher, published } = google(() => 403);
    const { notify } = notifierAt(log, fetcher);

    await notify(database(), [job('a'), job('b')]);

    expect(published).toHaveLength(1);
    expect(log.entries.find((entry) => entry.level === 'error')?.details).toMatchObject({
      statusCode: 403,
    });
  });

  it('a retitled card is not removed: its old address still answers with the live card', async () => {
    const log = testLogger();
    const { fetcher, published } = google();
    const { notify, clock } = notifierAt(log, fetcher);
    const db = database();

    await notify(db, [job('old-title-k1')]);
    await notify(db, [job('new-title-k1')]);
    clock.now = new Date(NOON.getTime() + 48 * HOUR_MS);
    await notify(db, [job('new-title-k1')]);

    expect(published.map(({ url, type }) => ({ url, type }))).toEqual([
      { url: absolute('old-title-k1'), type: 'URL_UPDATED' },
      { url: absolute('new-title-k1'), type: 'URL_UPDATED' },
    ]);
  });

  it('only 400 and 404 mean this address: any other 4xx stops the cycle and marks nothing', async () => {
    const log = testLogger();
    let status = 409;
    const { fetcher, published } = google(() => status);
    const { notify } = notifierAt(log, fetcher);
    const db = database();

    await notify(db, [job('a'), job('b')]);
    expect(published).toHaveLength(1);

    status = 200;
    published.length = 0;
    await notify(db, [job('a'), job('b')]);
    expect(published).toHaveLength(2);
  });

  it('a card Google rejects is logged, skipped and not resent', async () => {
    const log = testLogger();
    const { fetcher, published } = google((url) => (url.endsWith('/a') ? 400 : 200));
    const { notify } = notifierAt(log, fetcher);
    const db = database();

    await notify(db, [job('a'), job('b')]);
    await notify(db, [job('a'), job('b')]);

    expect(published.map((item) => item.url)).toEqual([absolute('a'), absolute('b')]);
    expect(log.entries.map((entry) => entry.message)).toContain('google-indexing-rejected');
  });

  it('a network failure or a failed token is logged and does not throw', async () => {
    const log = testLogger();
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('fetch failed'));
    const { notify } = notifierAt(log, fetcher);

    await expect(notify(database(), [job('a')])).resolves.toBeUndefined();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(log.entries.map((entry) => entry.level)).toContain('error');
    expect(JSON.stringify(log.entries)).not.toContain('PRIVATE KEY');
  });

  it('requests no token when there is nothing to send', async () => {
    const log = testLogger();
    const { fetcher } = google();
    const { notify } = notifierAt(log, fetcher);
    const db = database();

    await notify(db, [job('a')]);
    fetcher.mockClear();
    await notify(db, [job('a')]);

    expect(fetcher).not.toHaveBeenCalled();
  });
});
