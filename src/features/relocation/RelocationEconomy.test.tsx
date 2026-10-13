// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { RelocationEconomy } from './RelocationEconomy';

describe('RelocationEconomy', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it('identifies salary below an evidenced annual visa threshold', () => {
    render(40_000);

    const content = host?.textContent?.replace(/\s+/gu, ' ');
    expect(content).toContain('Зарплата ниже порога');
    expect(content).toContain('50 700 €');
    expect(host?.textContent).toContain('2026');
  });

  it('does not show a below-threshold warning when income exceeds known routes', () => {
    render(60_000);

    expect(host?.textContent).not.toContain('Зарплата ниже порога');
  });

  it('shows calculation errors instead of hiding invalid numeric input', () => {
    render(Number.POSITIVE_INFINITY);

    expect(host?.querySelector('[role="alert"]')?.textContent).toContain('Укажите годовую зарплату числом');
  });

  function render(income: number) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(
      <RelocationEconomy
        profile={emptyRelocationQuestionnaire()}
        selectedCountryCodes={['DE']}
        selectedCountryCode="DE"
        grossAnnualIncome={income}
        onCountryCodeChange={vi.fn()}
        onGrossAnnualIncomeChange={vi.fn()}
        onShowComparison={vi.fn()}
      />,
    ));
  }
});
