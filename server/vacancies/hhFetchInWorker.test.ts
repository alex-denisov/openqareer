import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { HhFetchEvent } from './hhSearchTransport';
import {
  createHhTransportInWorker,
  type HhFetchWorkerHandle,
  type HhFetchWorkerReply,
  type HhFetchWorkerRequest,
} from './hhFetchInWorker';

class FakeWorker extends EventEmitter implements HhFetchWorkerHandle {
  readonly sent: HhFetchWorkerRequest[] = [];
  terminated = false;
  postMessage(message: HhFetchWorkerRequest): void {
    this.sent.push(message);
  }
  reply(message: HhFetchWorkerReply): void {
    this.emit('message', message);
  }
  unref(): void {}
  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }
}

const EVENT: HhFetchEvent = {
  status: 200,
  totalMs: 420,
  headersMs: 300,
  bodyMs: 120,
  lagMs: 3,
  freshConnection: false,
};

function setup(timeoutMs = 60_000) {
  const workers: FakeWorker[] = [];
  const events: HhFetchEvent[] = [];
  const logs: string[] = [];
  const client = createHhTransportInWorker({
    spawn: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    onFetch: (event) => events.push(event),
    log: (_fields, message) => logs.push(message),
    timeoutMs,
  });
  return { client, workers, events, logs };
}

describe('B756: выборка hh.ru в своём потоке', () => {
  it('один поток на все запросы; ответ и замеры приходят из потока', async () => {
    const { client, workers, events } = setup();
    const first = client.transport('https://hh.ru/vacancy/1');
    const second = client.transport('https://hh.ru/vacancy/2');
    expect(workers).toHaveLength(1);
    const [a, b] = workers[0]!.sent;
    workers[0]!.reply({ event: EVENT });
    workers[0]!.reply({ id: b!.id, result: { status: 404, body: '' } });
    workers[0]!.reply({ event: EVENT });
    workers[0]!.reply({ id: a!.id, result: { status: 200, body: '<html>1</html>' } });
    await expect(first).resolves.toEqual({ status: 200, body: '<html>1</html>' });
    await expect(second).resolves.toEqual({ status: 404, body: '' });
    expect(events).toHaveLength(2);
  });

  it('поток упал — ожидающие получают отказ, следующий запрос поднимает новый поток', async () => {
    const { client, workers, logs } = setup();
    const pending = client.transport('https://hh.ru/vacancy/1');
    workers[0]!.emit('error', new Error('boom'));
    await expect(pending).resolves.toMatchObject({ status: 0, body: '', failure: 'WorkerFailed' });
    expect(logs).toContain('hh-fetch-worker-failed');
    void client.transport('https://hh.ru/vacancy/2');
    expect(workers).toHaveLength(2);
  });

  it('поток молчит дольше срока — отказ, поток снимается', async () => {
    vi.useFakeTimers();
    try {
      const { client, workers, logs } = setup(1_000);
      const pending = client.transport('https://hh.ru/vacancy/1');
      vi.advanceTimersByTime(1_001);
      await expect(pending).resolves.toMatchObject({ status: 0, failure: 'WorkerTimeout' });
      expect(workers[0]!.terminated).toBe(true);
      expect(logs).toContain('hh-fetch-worker-timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('close() снимает поток и отвечает отказом ожидающим; после — новых потоков нет', async () => {
    const { client, workers } = setup();
    const pending = client.transport('https://hh.ru/vacancy/1');
    await client.close();
    expect(workers[0]!.terminated).toBe(true);
    await expect(pending).resolves.toMatchObject({ status: 0, failure: 'WorkerClosed' });
    await expect(client.transport('https://hh.ru/vacancy/2')).resolves.toMatchObject({
      status: 0,
      failure: 'WorkerClosed',
    });
    expect(workers).toHaveLength(1);
  });

  it('поздний ответ на тот же id игнорируется', async () => {
    const { client, workers } = setup();
    const pending = client.transport('https://hh.ru/vacancy/1');
    const id = workers[0]!.sent[0]!.id;
    workers[0]!.reply({ id, result: { status: 200, body: 'x' } });
    workers[0]!.reply({ id, result: { status: 500, body: '' } });
    await expect(pending).resolves.toEqual({ status: 200, body: 'x' });
  });
});
