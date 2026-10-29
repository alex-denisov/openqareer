// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  searchLinkedInCompanies,
  type LinkedInCompanySearchDependencies,
} from './linkedinCompanySearch';

/** A fictional result card in the sanitized shape (see the extractor test). */
function card(slug: string, name: string, company: string): string {
  return `<div><a href="/in/${slug}/"><div><p componentkey="p1"><a href="/in/${slug}/">${name}</a><span> • 1st</span></p></div>
<div componentkey="SearchResultssnippet_X"><div><p><span>Current: Engineer at<span> </span><span><strong>${company}</strong></span></span></p></div></div></a></div>`;
}
const searchPage = (cards: readonly string[]) => `<main>${cards.join('')}</main>`;
const searchUrl = (company: string) =>
  `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(company)}&network=%5B%22F%22%5D`;

function dependencies(
  overrides: Partial<LinkedInCompanySearchDependencies> = {},
): LinkedInCompanySearchDependencies & {
  readonly reported: Array<{ companyName: string; people: readonly unknown[] }>;
  readonly read: string[];
} {
  const reported: Array<{ companyName: string; people: readonly unknown[] }> = [];
  const read: string[] = [];
  return {
    reported,
    read,
    isDesktop: true,
    linkedinConnected: true,
    throttle: { lastReadAt: () => undefined, markRead: () => undefined },
    isSessionOpen: async () => false,
    prepareRoute: async () => ({ release: async () => undefined }),
    openOutOfSight: async () => true,
    close: async () => undefined,
    log: () => undefined,
    loadPlan: async () => [{ companyKey: 'vektor', companyName: 'Вектор' }],
    readSessionPage: async (url) => {
      read.push(url);
      return {
        ok: true,
        url: searchUrl('Вектор'),
        body: searchPage([card('anna-t', 'Анна', 'Вектор')]),
      };
    },
    report: async (companyName, people) => {
      reported.push({ companyName, people });
    },
    ...overrides,
  };
}

describe('searchLinkedInCompanies (B561)', () => {
  it('opens the window on the feed, so every search page loads through the read', async () => {
    const openOutOfSight = vi.fn(async (_url: string) => true);
    await searchLinkedInCompanies(dependencies({ openOutOfSight }));
    expect(openOutOfSight).toHaveBeenCalledWith('https://www.linkedin.com/feed/');
  });

  it('stops and backs off three days when the 1st-circle filter is gone', async () => {
    const marks: number[] = [];
    const deps = dependencies({
      throttle: { lastReadAt: () => undefined, markRead: (at) => marks.push(at) },
      readSessionPage: async () => ({
        ok: true,
        url: 'https://www.linkedin.com/search/results/people/?keywords=Vektor',
        body: searchPage([card('anna-t', 'Анна', 'Вектор')]),
      }),
    });

    const outcome = await searchLinkedInCompanies(deps);

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'network_filter_lost' });
    expect(deps.reported).toEqual([]);
    expect(marks.at(-1)! - Date.now()).toBeGreaterThan(47 * 60 * 60 * 1_000);
  });

  it('ends the run after three empty result pages in a row', async () => {
    const deps = dependencies({
      loadPlan: async () =>
        ['a', 'b', 'c', 'd'].map((key) => ({ companyKey: key, companyName: key })),
      readSessionPage: async (url) => {
        deps.read.push(url);
        return { ok: true, url: searchUrl('a'), body: searchPage([]) };
      },
    });

    const outcome = await searchLinkedInCompanies(deps);

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'empty_pages', companies: 3 });
    expect(deps.read).toHaveLength(3);
    expect(deps.reported.map((entry) => entry.companyName)).toEqual(['a', 'b', 'c']);
  });

  it('searches each planned company and reports the people it read', async () => {
    const deps = dependencies({
      loadPlan: async () => [
        { companyKey: 'vektor', companyName: 'Вектор' },
        { companyKey: 'arka', companyName: 'Арка' },
      ],
    });

    const outcome = await searchLinkedInCompanies(deps);

    expect(outcome).toEqual({ status: 'searched', companies: 2, pages: 2, found: 2 });
    expect(deps.read).toHaveLength(2);
    expect(deps.read[0]).toContain('keywords=%D0%92%D0%B5%D0%BA%D1%82%D0%BE%D1%80');
    expect(deps.reported.map((entry) => entry.companyName)).toEqual(['Вектор', 'Арка']);
    expect(deps.reported[0]!.people).toEqual([
      {
        fullName: 'Анна',
        linkedinUrl: 'https://www.linkedin.com/in/anna-t/',
        roleTitle: 'Engineer',
        companyName: 'Вектор',
      },
    ]);
  });

  it('reads a second page only when the first one is full', async () => {
    const full = Array.from({ length: 10 }, (_, index) =>
      card(`p-${index}`, `Имя ${index}`, 'Вектор'),
    );
    const deps = dependencies({
      readSessionPage: async (url) => {
        deps.read.push(url);
        return {
          ok: true,
          url: searchUrl('Вектор'),
          body: searchPage(url.includes('page=2') ? [card('last', 'Последний', 'Вектор')] : full),
        };
      },
    });

    const outcome = await searchLinkedInCompanies(deps);

    expect(deps.read).toHaveLength(2);
    expect(deps.read[1]).toContain('page=2');
    expect(outcome).toMatchObject({ pages: 2, found: 11 });
    expect(deps.reported[0]!.people).toHaveLength(11);
  });

  it('stops the run when the desktop refuses a search over budget', async () => {
    const deps = dependencies({
      loadPlan: async () => [
        { companyKey: 'vektor', companyName: 'Вектор' },
        { companyKey: 'arka', companyName: 'Арка' },
      ],
      readSessionPage: async () => {
        throw new Error('linkedin_search_budget_exhausted');
      },
    });

    const outcome = await searchLinkedInCompanies(deps);

    expect(outcome).toEqual({
      status: 'stopped',
      reason: 'linkedin_search_budget_exhausted',
      companies: 0,
      pages: 0,
      found: 0,
    });
    expect(deps.reported).toEqual([]);
  });

  it('stops without reporting when LinkedIn redirects to a checkpoint', async () => {
    const marks: number[] = [];
    const deps = dependencies({
      throttle: { lastReadAt: () => undefined, markRead: (at) => marks.push(at) },
      readSessionPage: async () => ({
        ok: true,
        url: 'https://www.linkedin.com/checkpoint/challenge/',
        body: '<main></main>',
      }),
    });

    const outcome = await searchLinkedInCompanies(deps);

    expect(outcome).toMatchObject({ status: 'stopped', reason: 'checkpoint' });
    expect(deps.reported).toEqual([]);
    expect(marks.at(-1)! - Date.now()).toBeGreaterThan(47 * 60 * 60 * 1_000);
  });

  it('opens no window when nothing is planned or the read ran recently', async () => {
    const openOutOfSight = vi.fn(async () => true);
    expect(
      await searchLinkedInCompanies(dependencies({ loadPlan: async () => [], openOutOfSight })),
    ).toEqual({ status: 'skipped', reason: 'nothing_planned' });
    expect(
      await searchLinkedInCompanies(
        dependencies({
          openOutOfSight,
          throttle: { lastReadAt: () => Date.now() - 60_000, markRead: () => undefined },
        }),
      ),
    ).toEqual({ status: 'skipped', reason: 'recently_read' });
    expect(openOutOfSight).not.toHaveBeenCalled();
  });

  it('leaves the window alone while the candidate is using it', async () => {
    const openOutOfSight = vi.fn(async () => true);
    const outcome = await searchLinkedInCompanies(
      dependencies({ isSessionOpen: async () => true, openOutOfSight }),
    );
    expect(outcome).toEqual({ status: 'skipped', reason: 'window_unavailable', detail: 'in_use' });
    expect(openOutOfSight).not.toHaveBeenCalled();
  });
});
