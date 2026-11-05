// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useFocusRequest } from './useFocusRequest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ request, ready }: { readonly request?: number; readonly ready: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useFocusRequest(ref, request, ready);
  return ready ? <textarea ref={ref} data-testid="input" /> : <p>Загрузка</p>;
}

describe('useFocusRequest (Д4)', () => {
  let root: Root | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    document.body.innerHTML = '';
  });

  function mount(request: number | undefined, ready = true) {
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Probe request={request} ready={ready} />));
  }
  const rerender = (request: number | undefined, ready = true) =>
    act(() => root?.render(<Probe request={request} ready={ready} />));
  const input = () => document.querySelector('[data-testid="input"]');

  it('focuses the input on a new request', () => {
    mount(undefined);
    expect(document.activeElement).toBe(document.body);
    rerender(1);
    expect(document.activeElement).toBe(input());
  });

  it('focuses again on the next request after focus moved away', () => {
    mount(1);
    (document.activeElement as HTMLElement).blur();
    rerender(2);
    expect(document.activeElement).toBe(input());
  });

  it('waits until the input exists, then focuses once', () => {
    mount(1, false);
    rerender(1, true);
    expect(document.activeElement).toBe(input());
    (document.activeElement as HTMLElement).blur();
    rerender(1, true);
    expect(document.activeElement).toBe(document.body);
  });
});
