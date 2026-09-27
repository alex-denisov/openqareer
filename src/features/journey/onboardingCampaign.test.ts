import { describe, expect, it, vi } from 'vitest';
import { waitForModelCampaign } from './onboardingCampaign';

function campaign(origin: string) {
  return { roles: { origin }, autoRoles: origin === 'model' ? [{ id: 'ops.vp' }] : [] };
}

describe('waitForModelCampaign', () => {
  it('waits for model origin and returns the campaign that is ready', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(campaign('profile'))
      .mockResolvedValueOnce(campaign('model'));
    const result = await waitForModelCampaign(read, {
      timeoutMs: 90,
      pollIntervalMs: 10,
      sleep: async () => undefined,
    });

    expect(result).toEqual({ status: 'model', campaign: campaign('model') });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('keeps polling through temporary read failures', async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(campaign('model'));
    const result = await waitForModelCampaign(read, {
      timeoutMs: 90,
      pollIntervalMs: 10,
      sleep: async () => undefined,
    });

    expect(result.status).toBe('model');
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('returns an explicit timeout after the wait limit', async () => {
    let currentTime = 0;
    const read = vi.fn().mockResolvedValue(campaign('profile'));
    const result = await waitForModelCampaign(read, {
      timeoutMs: 90,
      pollIntervalMs: 30,
      now: () => currentTime,
      sleep: async (milliseconds) => {
        currentTime += milliseconds;
      },
    });

    expect(result).toEqual({ status: 'timeout' });
    expect(currentTime).toBe(90);
    expect(read).toHaveBeenCalledTimes(4);
  });
});
