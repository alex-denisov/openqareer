import { describe, expect, it } from 'vitest';
import { sessionLayoutForHost, MIN_SESSION_SIZE, workAreaLayout } from './connectorLayout';
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

describe('workAreaLayout (B464, mockup 12)', () => {
  const rectOf = (rect: Partial<DOMRect>) => ({ getBoundingClientRect: () => rect as DOMRect });

  it('covers the work area below the section header with a 16 px inset', () => {
    const header = rectOf({ bottom: 64, height: 64 });
    const main = {
      ...rectOf({ left: 76, top: 0, right: 1440, bottom: 900, width: 1364, height: 900 }),
      querySelectorAll: () => [rectOf({ bottom: 0, height: 0 }), header],
    };
    expect(workAreaLayout(main as unknown as HTMLElement)).toEqual({
      x: 92,
      y: 80,
      width: 1332,
      height: 804,
    });
  });

  it('keeps the 64 px section band when the screen hides the top bar (Аккаунт, 24.10)', () => {
    const hidden = rectOf({ bottom: 0, height: 0 });
    const main = {
      ...rectOf({ left: 76, top: 0, right: 1224, bottom: 778, width: 1148, height: 778 }),
      querySelectorAll: () => [hidden],
    };
    expect(workAreaLayout(main as unknown as HTMLElement)?.y).toBe(80);
  });

  it('gives up without a work area, so the native default applies', () => {
    expect(workAreaLayout(null)).toBeUndefined();
  });
});
