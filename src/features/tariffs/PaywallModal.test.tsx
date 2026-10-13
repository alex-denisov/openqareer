// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as coachApi from '../coach/coachApi';
import type { CandidateBillingSummary } from '../shell/candidateBillingApi';
import { PaywallModal } from './PaywallModal';

const freeSummary: CandidateBillingSummary = {
  currentPlan: 'free',
  subscription: null,
  plans: [
    { id: 'basic', name: 'Basic', amountKopecks: 399_000, currency: 'RUB', interval: 'month' },
    { id: 'pro', name: 'Pro', amountKopecks: 990_000, currency: 'RUB', interval: 'month' },
    { id: 'max', name: 'Max', amountKopecks: 3_990_000, currency: 'RUB', interval: 'month' },
  ],
};

describe('PaywallModal B470', () => {
  let host: HTMLDivElement;
  let root: Root;
  const close = vi.fn();
  const navigate = vi.fn();

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    close.mockClear();
    navigate.mockClear();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  function render(isOpen = true) {
    act(() =>
      root.render(
        <PaywallModal
          isOpen={isOpen}
          onClose={close}
          onNavigate={navigate}
          summary={freeSummary}
        />,
      ),
    );
  }

  it('does not render when closed', () => {
    render(false);
    expect(host.textContent).toBe('');
  });

  it('offers server-priced Basic and Pro and keeps Free capabilities visible', () => {
    render();
    const dialog = host.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute('aria-labelledby')).toBe(host.querySelector('h2')?.id);
    expect(host.textContent).toContain('Basic');
    expect(host.textContent?.replace(/[\u00a0\u202f]/gu, ' ')).toContain('3 990');
    expect(host.textContent).toContain('Pro');
    expect(host.textContent).toContain('Профиль, роли и подборка вакансий');
    expect(host.textContent).not.toContain('письмо за 2 дня');
    expect(host.textContent).not.toContain('Executive');
  });

  it('compares tariffs by navigating to the tariff page', () => {
    render();
    click('Сравнить тарифы');
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith('tariffs');
  });

  it('opens checkout after the candidate chooses a paid tariff', async () => {
    vi.spyOn(coachApi, 'getSession').mockResolvedValue({
      username: 'qa.candidate',
      email: 'verified@example.test',
      displayName: 'Тестовый кандидат',
      role: 'candidate',
      isTest: true,
      candidateId: 'candidate-b470',
      emailVerified: true,
    });
    render();
    click('Перейти на Basic');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.textContent).toContain('Ваш заказ');
    expect(host.textContent).toContain('verified@example.test');
    expect(host.textContent).toContain('Перейти к оплате');
  });

  it('focuses inside, traps Tab, closes with Escape and restores opener', async () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    render();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const buttons = host.querySelectorAll('button');
    expect(document.activeElement).toBe(buttons[0]);
    act(() =>
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          cancelable: true,
        }),
      ),
    );
    expect(document.activeElement).toBe(buttons[buttons.length - 1]);
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(close).toHaveBeenCalledOnce();
    render(false);
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  function click(label: string) {
    const button = [...host.querySelectorAll('button')].find((item) =>
      item.textContent?.replace(/[\u00a0\u202f]+/gu, ' ').includes(label),
    );
    if (!button) throw new Error(`Missing button: ${label}`);
    act(() => button.click());
  }
});
