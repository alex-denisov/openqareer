import { describe, expect, it, vi } from 'vitest';
import { sessionLayoutForHost, MIN_SESSION_SIZE, watchConnectorHost } from './connectorLayout';
import type { SessionLayout } from './connectorSession';

function hostAt(rect: Partial<DOMRect>): HTMLElement {
  return {
    getBoundingClientRect: () =>
      ({
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        toJSON: () => rect,
        ...rect,
      }) as DOMRect,
  } as unknown as HTMLElement;
}

const VIEWPORT = { innerWidth: 1440, innerHeight: 900 };

describe('sessionLayoutForHost', () => {
  it('keeps a healthy host rect as-is', () => {
    const layout = sessionLayoutForHost(
      hostAt({ x: 200, y: 120, width: 800, height: 600 }),
      VIEWPORT.innerWidth,
      VIEWPORT.innerHeight,
    );
    expect(layout).toEqual({ x: 200, y: 120, width: 800, height: 600 });
  });

  it('clamps a host that drifted below the fold so the window stays inside the frame', () => {
    const layout = sessionLayoutForHost(
      hostAt({ x: 100, y: 1400, width: 900, height: 620 }),
      VIEWPORT.innerWidth,
      VIEWPORT.innerHeight,
    );
    expect(layout?.y).toBe(VIEWPORT.innerHeight - 620);
    expect(layout?.y).toBeGreaterThanOrEqual(0);
  });

  it('clamps negative origins produced by transformed containers', () => {
    const layout = sessionLayoutForHost(
      hostAt({ x: -260, y: -80, width: 920, height: 620 }),
      VIEWPORT.innerWidth,
      VIEWPORT.innerHeight,
    );
    expect(layout?.x).toBe(0);
    expect(layout?.y).toBe(0);
  });

  it('shrinks oversized hosts to the viewport instead of overflowing it', () => {
    const layout = sessionLayoutForHost(
      hostAt({ x: 40, y: 40, width: 2200, height: 1400 }),
      VIEWPORT.innerWidth,
      VIEWPORT.innerHeight,
    );
    expect(layout?.width).toBeLessThanOrEqual(VIEWPORT.innerWidth);
    expect(layout?.height).toBeLessThanOrEqual(VIEWPORT.innerHeight);
    expect((layout?.x ?? 0) + (layout?.width ?? 0)).toBeLessThanOrEqual(VIEWPORT.innerWidth);
    expect((layout?.y ?? 0) + (layout?.height ?? 0)).toBeLessThanOrEqual(VIEWPORT.innerHeight);
  });

  it('never returns a layout smaller than the native minimum', () => {
    const layout: SessionLayout | undefined = sessionLayoutForHost(
      hostAt({ x: 10, y: 10, width: 80, height: 50 }),
      VIEWPORT.innerWidth,
      VIEWPORT.innerHeight,
    );
    expect(layout?.width).toBe(MIN_SESSION_SIZE.width);
    expect(layout?.height).toBe(MIN_SESSION_SIZE.height);
  });

  it('returns undefined without a host so the Rust default stays in charge', () => {
    expect(sessionLayoutForHost(null, 1440, 900)).toBeUndefined();
  });
});

describe('watchConnectorHost (B464)', () => {
  it('follows the host when it moves without resizing, e.g. under a toolbar that appeared', () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      innerWidth: 1224,
      innerHeight: 778,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      },
    );
    let rect = { x: 36, y: 95, width: 1154, height: 484 };
    const host = { getBoundingClientRect: () => ({ ...rect }) } as unknown as HTMLElement;
    const layouts: SessionLayout[] = [];
    const stop = watchConnectorHost('hh', host, (layout) => layouts.push(layout));
    rect = { ...rect, y: 139 };
    vi.advanceTimersByTime(1000);
    stop();
    expect(layouts.map((layout) => layout.y)).toEqual([95, 139]);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
