// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { emptyRelocationQuestionnaire } from '../../../shared/relocationQuestionnaire';
import { RelocationAddCountry } from './RelocationAddCountry';

describe('RelocationAddCountry (mockup 15 view=add)', () => {
  let host: HTMLDivElement | undefined;
  let root: Root | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it('marks a country with checked rules as addable and keeps the note visible', async () => {
    render();
    expect(host?.textContent).toContain('Добавленная страна появится в списке');
    await type('Герм');

    const row = host?.querySelector('.career-relocation-add-list li');
    expect(row?.textContent).toContain('Германия');
    expect(row?.textContent).toContain('Правила проверены');
    expect(row?.querySelector('.career-relocation-country-status.is-available')?.textContent).toBe(
      'Можно добавить',
    );
    expect(host?.textContent).not.toMatch(/\d+ ваканси/);
  });

  function render() {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root?.render(
        <RelocationAddCountry
          profile={emptyRelocationQuestionnaire()}
          pinnedCountryCodes={[]}
          onAdd={() => undefined}
          onDone={() => undefined}
        />,
      ),
    );
  }

  async function type(value: string) {
    const input = host?.querySelector<HTMLInputElement>('input[type="search"]');
    expect(input).toBeTruthy();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(input, value);
      input?.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
});
