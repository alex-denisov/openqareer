import { request as httpRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { backgroundStep } from './backgroundSteps';
import { syncSection } from './syncSections';
import { namedInFlight, registerEventLoopWatch } from './eventLoopWatch';

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
    expect(stall?.inFlight).toEqual([
      expect.objectContaining({ url: '/slow?offset=7&token=%5BREDACTED%5D' }),
    ]);
  });

  it('B769: names the background step and the GC time of a stall without requests', async () => {
    const log = vi.fn();
    const app = Fastify();
    registerEventLoopWatch(app, { log, stallMs: 100, tickMs: 10, reportMs: 60_000 });
    await app.ready();
    await backgroundStep('list-build', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      busy(250);
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await app.close();
    const stall = log.mock.calls.find(([, msg]) => msg === 'event-loop-stall')?.[0];
    expect(stall?.inFlightCount).toBe(0);
    expect(stall?.background).toEqual([expect.objectContaining({ name: 'list-build' })]);
    expect(stall?.background[0].overlapMs).toBeGreaterThanOrEqual(200);
    expect(typeof stall?.gcMs).toBe('number');
  });

  it('B770a-0: names the synchronous sections and the serialization that held the stall', async () => {
    const log = vi.fn();
    const app = Fastify();
    registerEventLoopWatch(app, { log, stallMs: 100, tickMs: 10, reportMs: 60_000 });
    app.get('/big/:id', async () => ({ toJSON: () => (busy(220), { ok: true }) }));
    app.get('/page/:n', async () => {
      busy(220);
      return 'html';
    });
    await app.ready();
    await backgroundStep('list:build', async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      syncSection('list:order', () => busy(220));
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await app.inject({ url: '/big/42?token=secret' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await app.inject({ url: '/page/7' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await app.close();
    const stalls = log.mock.calls
      .filter(([, msg]) => msg === 'event-loop-stall')
      .map(([fields]) => fields);
    const names = stalls.flatMap((stall) =>
      stall.sync.map((section: { name: string }) => section.name),
    );
    expect(names).toContain('list:order');
    expect(names).toContain('serialize GET /big/:id');
    expect(names).toContain('handler GET /page/:n');
    expect(JSON.stringify(stalls)).not.toContain('secret');
  });

  it('B770a-0: a preHandler that sends 401 without returning reply still stops the handler (app.test 18:11Z)', async () => {
    const app = Fastify();
    registerEventLoopWatch(app, { log: vi.fn(), stallMs: 100, tickMs: 10, reportMs: 60_000 });
    const handler = vi.fn(async () => ({ created: true }));
    app.post(
      '/guarded',
      {
        preHandler: async (_request, reply) => {
          reply.code(401).send({ error: 'unauthorized' });
        },
      },
      handler,
    );
    const response = await app.inject({ method: 'POST', url: '/guarded' });
    await app.close();
    expect(response.statusCode).toBe(401);
    expect(handler).not.toHaveBeenCalled();
  });

  it('forgets a request the client dropped (prod 03.11: 78 dropped reads named in every stall for hours)', async () => {
    const log = vi.fn();
    const app = Fastify();
    registerEventLoopWatch(app, { log, stallMs: 100, tickMs: 10, reportMs: 60_000 });
    app.get('/hang', () => new Promise(() => undefined));
    app.get('/slow', async () => {
      busy(250);
      return { ok: true };
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as AddressInfo;
    const dropped = httpRequest({ port, path: '/hang' });
    dropped.on('error', () => undefined);
    dropped.end();
    await new Promise((resolve) => setTimeout(resolve, 50));
    dropped.destroy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    await app.inject({ url: '/slow' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await app.close();
    const stall = log.mock.calls.find(([, msg]) => msg === 'event-loop-stall')?.[0];
    expect(stall?.inFlight).toEqual([expect.objectContaining({ url: '/slow' })]);
  });

  it('names the oldest unfinished requests before finished ones (prod 03.11: eight finished company reads hid what held a 7.6 s stall)', () => {
    const finished = Array.from({ length: 9 }, (_, index) => ({
      method: 'GET',
      url: `/fast/${index}`,
      ageMs: 80,
      finished: true,
    }));
    const open = { method: 'POST', url: '/held', ageMs: 7_600, finished: false };
    const named = namedInFlight([...finished, open]);
    expect(named).toHaveLength(8);
    expect(named[0]).toEqual(open);
    expect(named.slice(1).every((item) => item.finished)).toBe(true);
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
