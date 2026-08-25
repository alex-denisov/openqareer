import { describe, expect, it, vi } from 'vitest';
import { nextAnimationFrame, startConnectorSession } from './connectorSessionStart';
import type { SessionLayout, SessionOpenResult } from './connectorSession';

const LAYOUT: SessionLayout = { x: 33, y: 114, width: 1156, height: 640 };

function recorder() {
  const events: string[] = [];
  return {
    events,
    onStep: (step: string) => {
      events.push(`step:${step}`);
    },
  };
}

describe('startConnectorSession', () => {
  it('never announces session_open before the sign-in window exists', async () => {
    const { events, onStep } = recorder();
    const openSession = vi.fn(async (): Promise<SessionOpenResult> => {
      events.push('open:called');
      return { opened: true };
    });

    const result = await startConnectorSession({
      platform: 'hh',
      url: 'https://hh.ru/account/login',
      measureLayout: () => LAYOUT,
      waitForFrame: () => Promise.resolve(),
      onStep,
      openSession,
    });

    expect(result).toEqual({ opened: true });
    // The session poll turns on with `session_open`, and it asks the desktop
    // shell to inspect a window. Anything before `open:called` is a poll
    // against a window that does not exist yet (B157).
    expect(events).toEqual(['step:opening', 'open:called', 'step:session_open']);
  });

  it('measures the frame only after the step has announced opening', async () => {
    const { events, onStep } = recorder();

    await startConnectorSession({
      platform: 'linkedin',
      url: 'https://www.linkedin.com/login',
      measureLayout: () => {
        events.push('measure:called');
        return LAYOUT;
      },
      waitForFrame: () => {
        events.push('frame:awaited');
        return Promise.resolve();
      },
      onStep,
      openSession: async () => ({ opened: true }),
    });

    expect(events.slice(0, 3)).toEqual([
      'step:opening',
      'frame:awaited',
      'measure:called',
    ]);
  });

  it('hands the measured frame to the window it opens', async () => {
    const openSession = vi.fn(async (): Promise<SessionOpenResult> => ({ opened: true }));

    await startConnectorSession({
      platform: 'hh',
      url: 'https://hh.ru/account/login',
      measureLayout: () => LAYOUT,
      waitForFrame: () => Promise.resolve(),
      onStep: () => undefined,
      openSession,
    });

    expect(openSession).toHaveBeenCalledWith('hh', 'https://hh.ru/account/login', LAYOUT);
  });

  it('falls back to idle with a readable reason when no window appears', async () => {
    const { events, onStep } = recorder();

    const result = await startConnectorSession({
      platform: 'hh',
      url: 'https://hh.ru/account/login',
      measureLayout: () => LAYOUT,
      waitForFrame: () => Promise.resolve(),
      onStep,
      openSession: async () => ({ opened: false, reason: 'window_blocked' }),
    });

    expect(result.opened).toBe(false);
    expect(result.error).toContain('Браузер заблокировал окно входа hh.ru');
    expect(events).toEqual(['step:opening', 'step:idle']);
    expect(events).not.toContain('step:session_open');
  });

  it('keeps an unmeasurable frame from inventing a layout', async () => {
    const openSession = vi.fn(async (): Promise<SessionOpenResult> => ({ opened: true }));

    await startConnectorSession({
      platform: 'linkedin',
      url: 'https://www.linkedin.com/login',
      measureLayout: () => undefined,
      waitForFrame: () => Promise.resolve(),
      onStep: () => undefined,
      openSession,
    });

    expect(openSession).toHaveBeenCalledWith(
      'linkedin',
      'https://www.linkedin.com/login',
      undefined,
    );
  });
});

describe('nextAnimationFrame', () => {
  it('waits for a real frame when the runtime paints', async () => {
    const original = globalThis.requestAnimationFrame;
    const calls: unknown[] = [];
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: (callback: FrameRequestCallback) => {
        calls.push(callback);
        callback(0);
        return 1;
      },
    });

    await expect(nextAnimationFrame()).resolves.toBeUndefined();
    expect(calls).toHaveLength(1);

    if (original === undefined) {
      Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    } else {
      Object.defineProperty(globalThis, 'requestAnimationFrame', {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });

  it('does not stall a runtime that never paints', async () => {
    const original = globalThis.requestAnimationFrame;
    Reflect.deleteProperty(globalThis, 'requestAnimationFrame');

    await expect(nextAnimationFrame()).resolves.toBeUndefined();

    if (original !== undefined) {
      Object.defineProperty(globalThis, 'requestAnimationFrame', {
        configurable: true,
        writable: true,
        value: original,
      });
    }
  });
});
