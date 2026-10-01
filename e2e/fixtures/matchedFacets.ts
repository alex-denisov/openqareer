import type { Page } from '@playwright/test';
import { mockSignedInCabinet } from './mockSignedInCabinet';
import { matchedVacancies } from './readabilityWorkspace';

export const facets = {
  total: 3,
  regions: [
    { id: 'us', count: 2 },
    { id: 'eu', count: 1 },
  ],
  remote: 1,
  levels: [
    { level: 'head', count: 2 },
    { level: 'unknown', count: 1 },
  ],
  roles: [{ role: 'Enterprise Architect', count: 3 }],
  sources: [
    { sourceId: 'hh', name: 'hh.ru', count: 2 },
    { sourceId: 'remotive', name: 'Remotive', count: 1 },
  ],
};

const records = [
  { region: 'us', remote: true, level: 'head', source: 'hh' },
  { region: 'us', remote: false, level: 'unknown', source: 'remotive' },
  { region: 'eu', remote: false, level: 'head', source: 'hh' },
];

export async function mockMatchedFacets(page: Page): Promise<URL[]> {
  await mockSignedInCabinet(page);
  const reads: URL[] = [];
  await page.route('**/api/v1/candidate/matched-vacancies**', async (route) => {
    const url = new URL(route.request().url());
    reads.push(url);
    const params = url.searchParams;
    const selected = records.flatMap((record, index) => {
      const includes = (key: string, value: string) =>
        !params.has(key) || params.getAll(key).includes(value);
      if (
        !includes('region', record.region) ||
        !includes('level', record.level) ||
        !includes('source', record.source)
      )
        return [];
      if (params.get('remote') === '1' && !record.remote) return [];
      const item = matchedVacancies[index];
      return [
        {
          ...item,
          cluster: {
            ...item.cluster,
            canonicalTitle: 'Enterprise Architect',
            isRemote: record.remote,
          },
        },
      ];
    });
    return route.fulfill({
      json: {
        data: selected,
        meta: {
          total: selected.length,
          nextOffset: null,
          facets,
          campaign: {
            roles: { value: ['Enterprise Architect'], origin: 'explicit' },
            regions: { value: [], origin: 'profile' },
            remoteOnly: false,
          },
        },
      },
    });
  });
  return reads;
}
