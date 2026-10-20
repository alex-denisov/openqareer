// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as trialApi from './proTrialApi';
import * as billingApi from '../shell/candidateBillingApi';
import { ProTrialPanel } from './ProTrialPanel';

const eligible: trialApi.CandidateProTrial = {
  status: 'eligible',
  startedAt: null,
  expiresAt: null,
  serverNow: '2026-10-19T12:00:00.000Z',
};
const active: trialApi.CandidateProTrial = {
  status: 'active',
  startedAt: eligible.serverNow,
  expiresAt: '2026-10-20T12:00:00.000Z',
  serverNow: eligible.serverNow,
};

describe('ProTrialPanel', () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  async function mount(onSummaryChanged = vi.fn()) {
    await act(async () => root.render(<ProTrialPanel onSummaryChanged={onSummaryChanged} />));
  }
  async function click(label: string) {
    const button = [...host.querySelectorAll('button')].find((item) => item.textContent === label);
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }

  it('waits for the activation response and updates current entitlements from the server', async () => {
    vi.spyOn(trialApi, 'getProTrial').mockResolvedValue(eligible);
    vi.spyOn(trialApi, 'activateProTrial').mockResolvedValue(active);
    const summary: billingApi.CandidateBillingSummary = {
      currentPlan: 'pro',
      subscription: null,
      plans: [],
    };
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(summary);
    const changed = vi.fn();
    await mount(changed);
    await click('Включить Pro на 24 часа бесплатно');
    expect(trialApi.activateProTrial).toHaveBeenCalledOnce();
    expect(changed).toHaveBeenCalledWith(summary);
    expect(host.textContent).toContain('Пробный Pro включён');
    expect(host.textContent).toContain('Списаний нет');
    expect(host.querySelectorAll('button')).toHaveLength(0);
  });

  it('rechecks expiry at the server deadline even when a parent callback changes', async () => {
    vi.useFakeTimers();
    const get = vi.spyOn(trialApi, 'getProTrial').mockResolvedValue(active);
    const summary: billingApi.CandidateBillingSummary = {
      currentPlan: 'free',
      subscription: null,
      plans: [],
    };
    vi.spyOn(billingApi, 'getCandidateBillingSummary').mockResolvedValue(summary);
    await mount();
    await act(async () => {
      vi.advanceTimersByTime(23 * 60 * 60 * 1000);
    });
    await mount();
    get.mockResolvedValue({ ...active, status: 'expired', serverNow: active.expiresAt! });
    await act(async () => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });
    expect(host.textContent).toContain('Пробный Pro завершён');
    expect(host.textContent).toContain('Сейчас действует Free');
  });

  it('keeps an activation error visible and supports checking the server state', async () => {
    vi.spyOn(trialApi, 'getProTrial').mockResolvedValue(eligible);
    vi.spyOn(trialApi, 'activateProTrial').mockRejectedValue(new Error('offline'));
    await mount();
    await click('Включить Pro на 24 часа бесплатно');
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Не удалось');
    await click('Повторить проверку');
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows expiration without offering repeat activation and hides the offer for paid users', async () => {
    const get = vi
      .spyOn(trialApi, 'getProTrial')
      .mockResolvedValue({ ...active, status: 'expired' });
    await mount();
    expect(host.textContent).toContain('Пробный Pro завершён');
    expect(host.textContent).toContain('Повторно включить пробный Pro нельзя');
    expect(host.querySelector('button')).toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    get.mockResolvedValue({ ...eligible, status: 'unavailable' });
    await mount();
    expect(host.textContent).toBe('');
  });
});
