// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountryComparisonPanel } from './CountryComparisonPanel';

describe('CountryComparisonPanel interactions', () => {
  let host: HTMLDivElement | undefined;
  let root: ReturnType<typeof createRoot> | undefined;

  afterEach(() => {
    if (root) act(() => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it('calls the supplied retry action when the user activates it', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const retry = vi.fn();

    act(() =>
      root?.render(
        <CountryComparisonPanel state="error" errorMessage="Нет соединения." onRetry={retry} />,
      ),
    );
    act(() => host?.querySelector('button')?.click());

    expect(retry).toHaveBeenCalledOnce();
  });
});
