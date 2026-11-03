import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_VACANCY_SOURCES } from './defaultVacancySources';
import { buildMultiSourceFetcher } from './multiSourceFetcher';

const source = DEFAULT_VACANCY_SOURCES.find((s) => s.id === 'src-linkedin-crawler')!;
const unused = (async () => {
  throw new Error('not used');
}) as never;

describe('src-linkedin-crawler dispatch', () => {
  it('returns an empty partial reading, not the Obscura crawler, when no pool reader is wired', async () => {
    const legacy = vi.fn(async () => ({ vacancies: [], partial: false }));
    const fetcher = buildMultiSourceFetcher(unused, unused, undefined, { fetchLinkedinCrawler: legacy });
    await expect(fetcher(source)).resolves.toEqual({ vacancies: [], partial: true });
    expect(legacy).not.toHaveBeenCalled();
  });

  it('uses the pool reader when wired', async () => {
    const reading = { vacancies: [], partial: true };
    const fetcher = buildMultiSourceFetcher(unused, unused, undefined, { readLinkedinPoolJobs: () => reading });
    await expect(fetcher(source)).resolves.toBe(reading);
  });
});
