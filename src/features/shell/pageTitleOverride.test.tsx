// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { usePageTitleOverride, usePageTitleOverrideValue } from './pageTitleOverride';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Title() {
  return <h1>{usePageTitleOverrideValue() ?? 'Карьера'}</h1>;
}

function Sub() {
  usePageTitleOverride('Страны и релокация');
  return null;
}

describe('page title override', () => {
  it('names the page while the sub-screen is mounted and restores it after', () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() =>
      root.render(
        <>
          <Title />
          <Sub />
        </>,
      ),
    );
    expect(host.querySelector('h1')?.textContent).toBe('Страны и релокация');
    act(() => root.render(<Title />));
    expect(host.querySelector('h1')?.textContent).toBe('Карьера');
    act(() => root.unmount());
  });
});
