import { afterEach, describe, expect, it } from 'vitest';
import {
  heldSyncSections,
  recordSyncSection,
  resetSyncSections,
  syncSection,
} from './syncSections';

function busy(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // synchronous work holding the event loop
  }
}

afterEach(() => resetSyncSections());

describe('B770a-0: own synchronous ms of named sections', () => {
  it('times the synchronous part of a section and returns its value', () => {
    const windowStart = performance.now();
    expect(syncSection('list:order', () => (busy(30), 7))).toBe(7);
    const held = heldSyncSections(windowStart, performance.now());
    expect(held).toEqual([{ name: 'list:order', ms: expect.any(Number) }]);
    expect(held[0]!.ms).toBeGreaterThanOrEqual(25);
  });

  it('records a section that throws, and rethrows', () => {
    const windowStart = performance.now();
    expect(() =>
      syncSection('list:seal', () => {
        busy(20);
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(heldSyncSections(windowStart, performance.now())[0]?.name).toBe('list:seal');
  });

  it('sums a name within the window, longest first, short sections ignored', () => {
    const start = 1_000;
    recordSyncSection('fit:read', start + 10, 40);
    recordSyncSection('fit:read', start + 60, 30);
    recordSyncSection('list:seal', start + 100, 120);
    recordSyncSection('list:tiny', start + 230, 1);
    recordSyncSection('list:before', start - 500, 50);
    expect(heldSyncSections(start, start + 300)).toEqual([
      { name: 'list:seal', ms: 120 },
      { name: 'fit:read', ms: 70 },
    ]);
  });
});
