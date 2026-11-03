import { describe, expect, it } from 'vitest';
import { HhVacancyDescriptionLoader } from './hhVacancyDescription';
import { HH_TEXT_RATE_DEFAULTS, HhTextRateController } from './hhTextRate';

const page = '<main><div data-qa="vacancy-description"><p>Полное описание</p></div></main>';
const url = (n: number) => `https://hh.ru/vacancy/${n}`;

function setup(respond: (n: number) => { status: number; body: string; retryAfterMs?: number }) {
  let now = 0;
  const starts: number[] = [];
  let calls = 0;
  const rate = new HhTextRateController({ now: () => now });
  const loader = new HhVacancyDescriptionLoader({
    transport: async () => {
      starts.push(now);
      calls += 1;
      return respond(calls);
    },
    sleep: async (ms) => {
      now += ms;
    },
    now: () => now,
    failedCacheJitterMs: 0,
    rate,
  });
  return { loader, rate, starts, advance: (ms: number) => (now += ms) };
}

describe('hh text loader with adaptive rate (03.11)', () => {
  it('spaces starts by the controller interval, not by a fixed second', async () => {
    const { loader, starts } = setup(() => ({ status: 200, body: page }));
    await Promise.all([1, 2, 3].map((n) => loader.load(url(n))));
    const gap = Math.round(1_000 / HH_TEXT_RATE_DEFAULTS.startRatePerSec);
    expect(starts[2]! - starts[1]!).toBe(gap);
  });

  it('halves the rate and pauses on the first refusal', async () => {
    const { loader, rate } = setup(() => ({ status: 429, body: '' }));
    const before = rate.snapshot().ratePerSec;
    const result = await loader.load(url(1));
    expect(result).toMatchObject({ blocked: 'refused' });
    expect(rate.snapshot().ratePerSec).toBe(
      Math.max(HH_TEXT_RATE_DEFAULTS.minRatePerSec, before / 2),
    );
    expect(await loader.load(url(2))).toMatchObject({ blocked: 'backoff' });
  });

  it('honours Retry-After when longer than the base pause', async () => {
    const { loader, advance } = setup(() => ({ status: 429, body: '', retryAfterMs: 300_000 }));
    await loader.load(url(1));
    advance(200_000);
    expect(await loader.load(url(2))).toMatchObject({ blocked: 'backoff' });
  });

  it('treats a captcha page as a refusal', async () => {
    const { loader, rate } = setup(() => ({ status: 200, body: '<html>showcaptcha</html>' }));
    expect(await loader.load(url(1))).toMatchObject({ blocked: 'refused' });
    expect(rate.snapshot().refusalsTotal).toBe(1);
  });

  it('counts 5xx as server errors, not refusals', async () => {
    const { loader, rate } = setup(() => ({ status: 503, body: '' }));
    await loader.load(url(1));
    expect(rate.snapshot().refusalsTotal).toBe(0);
  });
});
