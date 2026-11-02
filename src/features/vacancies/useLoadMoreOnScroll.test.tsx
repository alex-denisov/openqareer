// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLoadMoreOnScroll } from './useLoadMoreOnScroll';

/** An observer that reports its target in view as soon as it observes it, like a visible list end. */
let observers = 0;
class VisibleObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe() {
    observers += 1;
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as never);
  }
  disconnect() {}
}

function List({ onLoadMore }: { readonly onLoadMore: () => void }) {
  const sentinel = useLoadMoreOnScroll(true, () => onLoadMore());
  return <div ref={sentinel} />;
}

describe('useLoadMoreOnScroll (02.11 AUD-4)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('a re-render with a new callback does not load again while the list end stays in view', async () => {
    vi.stubGlobal('IntersectionObserver', VisibleObserver);
    observers = 0;
    const onLoadMore = vi.fn();
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(<List onLoadMore={onLoadMore} />));
    for (let render = 0; render < 3; render += 1) {
      await act(async () => root.render(<List onLoadMore={onLoadMore} />));
    }
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(observers).toBe(1);
    await act(async () => root.unmount());
  });
});
