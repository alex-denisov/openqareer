import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { registerEventLoopWatch } from './eventLoopWatch';

function busy(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // a synchronous handler holding the event loop
  }
}

describe('event loop watch (CPO prod 02.11: /health 37 s, static files 23 s)', () => {
  it('names the requests in flight when the loop stalls', async () => {
    const log = vi.fn();
    const app = Fastify();
    registerEventLoopWatch(app, { log, stallMs: 100, tickMs: 10, reportMs: 60_000 });
    app.get('/slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      busy(250);
      return { ok: true };
    });
    await app.ready();
    await app.inject({ url: '/slow?offset=7&token=secret-value' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await app.close();
    const stall = log.mock.calls.find(([, msg]) => msg === 'event-loop-stall')?.[0];
    expect(stall?.stallMs).toBeGreaterThanOrEqual(150);
    expect(stall?.inFlight).toEqual([expect.objectContaining({ url: '/slow?offset=7&token=%5BREDACTED%5D' })]);
  });

  it('reports loop delay per period', async () => {
    const log = vi.fn();
    const app = Fastify();
    registerEventLoopWatch(app, { log, stallMs: 10_000, tickMs: 10, reportMs: 60 });
    await app.ready();
    busy(80);
    await new Promise((resolve) => setTimeout(resolve, 120));
    await app.close();
    const report = log.mock.calls.find(([, msg]) => msg === 'event-loop-lag')?.[0];
    expect(report).toEqual(
      expect.objectContaining({
        p50Ms: expect.any(Number),
        p99Ms: expect.any(Number),
        maxMs: expect.any(Number),
        utilization: expect.any(Number),
      }),
    );
  });
});
