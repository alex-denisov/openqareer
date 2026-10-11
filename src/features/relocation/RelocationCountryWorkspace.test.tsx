// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { RelocationCountryWorkspace } from './RelocationCountryWorkspace';

describe('RelocationCountryWorkspace', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it('shows country facts with sources and explicit no-data reasons', async () => {
    render();
    await clickButton('Германия');

    expect(host?.textContent).toContain('Доступные сведения по стране');
    expect(host?.textContent).toContain('Порог дохода для статуса');
    expect(host?.textContent).toContain('EU Blue Card');
    expect(host?.textContent).toContain('Вакансии с релокацией');
    expect(host?.textContent).toContain('Нет проверенных данных');
    expect(host?.textContent).toContain('2026');
  });

  it('opens the economy calculation for the expanded country', async () => {
    const onCalculateEconomy = vi.fn();
    render(onCalculateEconomy);
    await clickButton('Германия');
    await clickButton('Посчитать экономику');

    expect(onCalculateEconomy).toHaveBeenCalledWith('DE');
  });

  function render(onCalculateEconomy: (countryCode: string) => void = () => undefined) {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(
      <RelocationCountryWorkspace
        profile={emptyRelocationQuestionnaire()}
        selectedCountryCodes={[]}
        onSelectedCountryCodesChange={() => undefined}
        onCompare={() => undefined}
        onCalculateEconomy={onCalculateEconomy}
        onOpenProfile={() => undefined}
      />,
    ));
  }

  async function clickButton(label: string) {
    const button = [...(host?.querySelectorAll('button') ?? [])].find((item) => item.textContent?.includes(label));
    expect(button).toBeDefined();
    await act(async () => { button?.click(); });
  }
});
