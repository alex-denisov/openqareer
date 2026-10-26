// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as scenarioApi from './relocationScenarioApi';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { RelocationEconomy } from './RelocationEconomy';

describe('RelocationEconomy', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    vi.useRealTimers();
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

  it('labels tax calculations with a stale data warning after 90 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-10T12:00:00.000Z'));
    render(40_000);

    expect(host?.textContent).toContain('Данные устарели');
    expect(host?.textContent).toContain('прошло больше 90 дней');
  });

  it('shows calculation errors instead of hiding invalid numeric input', () => {
    render(-1);

    expect(host?.querySelector('[role="alert"]')?.textContent).toContain(
      'Укажите годовую зарплату числом',
    );
  });

  it('shows the mockup breakdown: taxes from the scale, no invented rent, insurance or remainder', () => {
    render(120_000);

    const legend = host?.querySelector('.career-relocation-economy-legend')?.textContent ?? '';
    expect(legend).toMatch(/Налоги и взносы\s*\d+ %/u);
    expect(legend).toContain('Аренда');
    expect(legend).toContain('нет данных');
    expect(host?.textContent).toContain('Откуда цифры');
    expect(host?.querySelector('input[type="range"]')).not.toBeNull();
  });

  it('shows Germany at 140 000 € by the BMF wage tax and names its assumptions in «Откуда цифры»', () => {
    render(140_000);

    const legend = host?.querySelector('.career-relocation-economy-legend')?.textContent ?? '';
    expect(legend).toMatch(/Налоги и взносы\s*43 %/u);
    const sources = host?.querySelector('.career-relocation-economy-sources')?.textContent ?? '';
    expect(sources).toContain(
      'I налоговый класс, без церковного налога, государственная медстраховка со средней надбавкой 2,9%, без детей',
    );
  });

  it('opens the scenario editor with «Сбросить · Сохранить · Рассчитать» and returns to the calculation', async () => {
    render(120_000);
    await click('Уточнить расходы');

    const actions = [
      ...(host?.querySelectorAll('.career-relocation-scenario-actions button') ?? []),
    ].map((button) => button.textContent?.trim());
    expect(actions).toEqual(['Сбросить', 'Сохранить', 'Рассчитать']);
    expect(host?.querySelector('select option[value="Берлин"]')).not.toBeNull();
    expect(host?.textContent).toContain('Сколько детей переезжает');

    await click('К расчёту');
    expect(host?.textContent).toContain('Откуда цифры');
  });

  it('без страны «Уточнить расходы» просит выбрать страну и ставит на неё фокус (26.10)', async () => {
    render(120_000, '');
    await click('Уточнить расходы');

    expect(host?.querySelector('[role="alert"]')?.textContent).toContain(
      'Выберите страну — редактор расходов откроется для неё',
    );
    expect(document.activeElement?.id).toBe('career-relocation-economy-country');
    expect(host?.textContent).not.toContain('Сколько детей переезжает');
  });

  async function click(label: string) {
    const button = [...(host?.querySelectorAll('button') ?? [])].find((item) =>
      item.textContent?.includes(label),
    );
    expect(button).toBeDefined();
    await act(async () => {
      button?.click();
    });
  }

  function render(income: number, countryCode = 'DE') {
    vi.spyOn(scenarioApi, 'listRelocationScenarios').mockResolvedValue({
      items: [],
      nextOffset: null,
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root?.render(
        <RelocationEconomy
          profile={emptyRelocationQuestionnaire()}
          selectedCountryCodes={countryCode ? [countryCode] : []}
          selectedCountryCode={countryCode}
          grossAnnualIncome={income}
          onCountryCodeChange={vi.fn()}
          onGrossAnnualIncomeChange={vi.fn()}
          onShowComparison={vi.fn()}
        />,
      ),
    );
  }
});
