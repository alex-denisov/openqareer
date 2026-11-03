import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildMultiSourceFetcher } from './multiSourceFetcher';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';

const refuse = () => {
  throw new Error('the fetcher must not reach any platform in this test');
};
const amazon = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-amazon-jobs')!;

afterEach(() => vi.unstubAllGlobals());

describe('paged source page timeouts (03.11 Apple, Amazon)', () => {
  const run = () =>
    buildMultiSourceFetcher(refuse, refuse, undefined, { sleep: async () => {}, now: () => 0 })(
      { ...amazon },
    );
  const page = (n: number) =>
    new Response(
      JSON.stringify({
        hits: 500,
        jobs: [
          {
            id_icims: String(n),
            title: 'Engineer',
            company_name: 'Amazon',
            job_path: `/en/jobs/${n}`,
            posted_date: 'November 1, 2026',
            location: 'Seattle, WA, USA',
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );

  it('a first page that times out once is retried, not a failed poll', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      if (calls === 1) throw new DOMException('timeout', 'TimeoutError');
      if (calls > 3) return new Response('{"hits":0,"jobs":[]}', { status: 200 });
      return page(calls);
    });
    const reading = await run();
    expect((reading as { vacancies: unknown[] }).vacancies).toHaveLength(2);
  });

  it('a first page that keeps timing out is still a source failure', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new DOMException('timeout', 'TimeoutError');
    });
    await expect(run()).rejects.toThrow(/timeout/);
  });

  it('a timeout after some pages returns them as a partial reading', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls += 1;
      if (calls <= 2) return page(calls);
      throw new DOMException('timeout', 'TimeoutError');
    });
    const reading = await run();
    expect(reading).toMatchObject({ partial: true });
    expect((reading as { vacancies: unknown[] }).vacancies).toHaveLength(2);
  });
});
