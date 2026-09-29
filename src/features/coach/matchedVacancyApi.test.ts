import { afterEach, describe, expect, it, vi } from 'vitest';
import { saveCandidateCampaign } from './matchedVacancyApi';
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

