// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import * as matchedVacancyApi from '../coach/matchedVacancyApi';
import { useVacancyCampaignActions } from './useVacancyCampaignActions';

describe('useVacancyCampaignActions', () => {
  const sampleCampaign = {
    roles: { value: ['Product Director'], origin: 'explicit' as const },
    regions: { value: ['Москва'], origin: 'explicit' as const },
    remoteOnly: false,
    autoRoles: [{ id: 'pd-1', title: 'Product Director', kind: 'primary' as const }],
  };

  it('adds a custom role and saves campaign', async () => {
    const onCampaignUpdated = vi.fn();
    const updatedCampaign = {
      ...sampleCampaign,
      roles: { value: ['Product Director', 'Head of Product'], origin: 'explicit' as const },
    };
    const spy = vi
      .spyOn(matchedVacancyApi, 'saveCandidateCampaign')
      .mockResolvedValue(updatedCampaign as any);

    let actionsRef: ReturnType<typeof useVacancyCampaignActions> | null = null;
    function TestComponent() {
      actionsRef = useVacancyCampaignActions(sampleCampaign as any, { onCampaignUpdated });
      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<TestComponent />);
    });

    let ok = false;
    await act(async () => {
      ok = await actionsRef!.addCustomRole('Head of Product');
    });

    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledWith({
      roles: [{ id: 'pd-1', title: 'Product Director' }, 'Head of Product'],
      regions: ['Москва'],
      remoteOnly: false,
    });
    expect(onCampaignUpdated).toHaveBeenCalledWith(updatedCampaign, 'Head of Product');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('rejects adding role when limit of 10 is reached or duplicate', async () => {
    const fullCampaign = {
      ...sampleCampaign,
      roles: {
        value: Array.from({ length: 10 }, (_, i) => `Role ${i + 1}`),
        origin: 'explicit' as const,
      },
    };
    let actionsRef: ReturnType<typeof useVacancyCampaignActions> | null = null;
    function TestComponent() {
      actionsRef = useVacancyCampaignActions(fullCampaign as any, { onCampaignUpdated: vi.fn() });
      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<TestComponent />);
    });

    let ok = false;
    await act(async () => {
      ok = await actionsRef!.addCustomRole('Extra Role');
    });
    expect(ok).toBe(false);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('removes a role from campaign', async () => {
    const onCampaignUpdated = vi.fn();
    const updatedCampaign = {
      ...sampleCampaign,
      roles: { value: [], origin: 'explicit' as const },
    };
    const spy = vi
      .spyOn(matchedVacancyApi, 'saveCandidateCampaign')
      .mockResolvedValue(updatedCampaign as any);

    let actionsRef: ReturnType<typeof useVacancyCampaignActions> | null = null;
    function TestComponent() {
      actionsRef = useVacancyCampaignActions(sampleCampaign as any, { onCampaignUpdated });
      return null;
    }

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<TestComponent />);
    });

    let ok = false;
    await act(async () => {
      ok = await actionsRef!.removeRole('Product Director');
    });

    expect(ok).toBe(true);
    expect(spy).toHaveBeenCalledWith({
      roles: [],
      regions: ['Москва'],
      remoteOnly: false,
    });
    expect(onCampaignUpdated).toHaveBeenCalledWith(updatedCampaign, undefined);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
