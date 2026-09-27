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
