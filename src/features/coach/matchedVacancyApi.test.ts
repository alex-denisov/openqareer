import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMatchedVacancyFacets, getMatchedVacancyPage, saveCandidateCampaign } from './matchedVacancyApi';
import * as apiClient from './apiClient';

describe('saveCandidateCampaign', () => {
  afterEach(() => vi.restoreAllMocks());

  it('writes explicit role, region, and remote changes to the campaign endpoint', async () => {
    const input = {
      roles: [
        'VP Technology Ops',
        { id: 'ops-coo', title: 'COO' },
      ],
      regions: ['eu', 'mena'],
      remoteOnly: true,
    } as const;
    const responseData = {
      roles: { value: ['VP Technology Ops', 'COO'], origin: 'explicit' },
      regions: { value: ['eu', 'mena'], origin: 'explicit' },
      remoteOnly: true,
      autoRoles: [{ id: 'ops-coo', title: 'COO', kind: 'adjacent' as const }],
    };
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ data: responseData }), { status: 200 }),
    );

    await expect(saveCandidateCampaign(input)).resolves.toEqual(responseData);
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  });
});

describe('updateCampaignRoles', () => {
  afterEach(() => vi.restoreAllMocks());

  it('updates campaign roles using base campaign regions and remoteOnly', async () => {
    const { updateCampaignRoles } = await import('./matchedVacancyApi');
    const baseCampaign = {
      roles: { value: ['VP Tech'], origin: 'explicit' as const },
      regions: { value: ['eu'], origin: 'explicit' as const },
      remoteOnly: true,
    };
    const responseData = {
      roles: { value: ['VP Tech', 'Head of Product'], origin: 'explicit' },
      regions: { value: ['eu'], origin: 'explicit' },
      remoteOnly: true,
    };
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ data: responseData }), { status: 200 }),
    );

    const updated = await updateCampaignRoles(['VP Tech', 'Head of Product'], baseCampaign);
    expect(updated).toEqual(responseData);
    expect(spy).toHaveBeenCalledWith('/api/v1/candidate/campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        roles: ['VP Tech', 'Head of Product'],
        regions: ['eu'],
        remoteOnly: true,
      }),
    });
  });
});

describe('B725: страница 0 и фасеты двумя запросами', () => {
  afterEach(() => vi.restoreAllMocks());
  const facets = { total: 3, regions: [], remote: 0, levels: [], roles: [], sources: [] };

  it('страница строк просит part=rows', async () => {
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [], meta: { total: 0, nextOffset: null } }), { status: 200 }),
    );
    await getMatchedVacancyPage(0, undefined, undefined, 'rows');
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain('offset=0');
    expect(url).toContain('part=rows');
  });

  it('фасеты — отдельный запрос с теми же условиями и поясом', async () => {
    const spy = vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ data: [], meta: { total: 3, facets } }), { status: 200 }),
    );
    const filters = { roles: ['COO'], regions: ['eu'], levels: [], sources: [], remoteOnly: true };
    await expect(getMatchedVacancyFacets(undefined, filters)).resolves.toEqual(facets);
    const url = new URL(String(spy.mock.calls[0]?.[0]), 'https://x.test');
    expect(url.pathname).toBe('/api/v1/candidate/matched-vacancies');
    expect(url.searchParams.get('part')).toBe('facets');
    expect(url.searchParams.get('offset')).toBe('0');
    expect(url.searchParams.getAll('role')).toEqual(['COO']);
    expect(url.searchParams.get('remote')).toBe('1');
    expect(url.searchParams.get('tz')).toBeTruthy();
  });

  it('ошибка фасетов — ошибка запроса, а не пустые фасеты', async () => {
    vi.spyOn(apiClient, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { code: 'x', message: 'x' } }), { status: 500 }),
    );
    await expect(getMatchedVacancyFacets()).rejects.toBeTruthy();
  });
});
