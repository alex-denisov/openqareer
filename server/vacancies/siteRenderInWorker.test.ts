import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  createRenderInWorker,
  type RenderWorkerHandle,
  type RenderWorkerReply,
  type RenderWorkerRequest,
} from './siteRenderInWorker';

class FakeWorker extends EventEmitter implements RenderWorkerHandle {
  readonly sent: RenderWorkerRequest[] = [];
  terminated = false;
  postMessage(message: RenderWorkerRequest): void {
    this.sent.push(message);
  }
  reply(message: RenderWorkerReply): void {
    this.emit('message', message);
  }
  unref(): void {}
  async terminate(): Promise<number> {
    this.terminated = true;
    return 0;
  }
}

function setup(overrides: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}) {
  const workers: FakeWorker[] = [];
  const logs: Array<{ fields: Record<string, unknown>; message: string }> = [];
  const render = createRenderInWorker({
    spawn: () => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    },
    log: (fields, message) => logs.push({ fields, message }),
    timeoutMs: overrides.timeoutMs ?? 60_000,
    env: overrides.env ?? {},
  });
  return { render, workers, logs };
}

describe('createRenderInWorker', () => {
  it('рендерит в отдельном потоке и возвращает HTML по номеру запроса', async () => {
    const { render, workers } = setup();
    const first = render('https://a.example.com/careers');
    const second = render('https://b.example.com/jobs');
    expect(workers).toHaveLength(1);
    const [a, b] = workers[0]!.sent;
    workers[0]!.reply({ id: b!.id, html: '<b/>' });
    workers[0]!.reply({ id: a!.id, html: '<a/>' });
    await expect(first).resolves.toBe('<a/>');
    await expect(second).resolves.toBe('<b/>');
  });

  it('в поток уходят не больше двух адресов сразу: бюджет считается от отправки, не от очереди', async () => {
    const { render, workers } = setup();
    const results = ['a', 'b', 'c'].map((h) => render(`https://${h}.example.com/careers`));
    const worker = workers[0]!;
    expect(worker.sent.map((m) => m.url)).toHaveLength(2);
    worker.reply({ id: worker.sent[0]!.id, html: '<a/>' });
    await results[0];
    expect(worker.sent).toHaveLength(3);
    worker.reply({ id: worker.sent[1]!.id, html: '<b/>' });
    worker.reply({ id: worker.sent[2]!.id, html: '<c/>' });
    await expect(Promise.all(results)).resolves.toEqual(['<a/>', '<b/>', '<c/>']);
  });

  it('передаёт строки журнала потока в журнал обслуживания', async () => {
    const { render, workers, logs } = setup();
    const pending = render('https://a.example.com/careers');
    const { id } = workers[0]!.sent[0]!;
    workers[0]!.reply({
      log: { fields: { host: 'a.example.com' }, message: 'site-render-page-done' },
    });
    workers[0]!.reply({ id });
    await expect(pending).resolves.toBeUndefined();
    expect(logs).toContainEqual({
      fields: { host: 'a.example.com' },
      message: 'site-render-page-done',
    });
  });

  it('падение потока завершает ожидающие рендеры без HTML, следующий рендер поднимает новый поток', async () => {
    const { render, workers, logs } = setup();
    const pending = render('https://a.example.com/careers');
    workers[0]!.emit('error', new TypeError('boom'));
    await expect(pending).resolves.toBeUndefined();
    expect(logs.map((l) => l.message)).toContain('site-render-worker-failed');
    const next = render('https://b.example.com/jobs');
    expect(workers).toHaveLength(2);
    workers[1]!.reply({ id: workers[1]!.sent[0]!.id, html: '<b/>' });
    await expect(next).resolves.toBe('<b/>');
  });

  it('поток не ответил за бюджет: рендер без HTML, поток останавливается', async () => {
    vi.useFakeTimers();
    try {
      const { render, workers, logs } = setup({ timeoutMs: 1_000 });
      const pending = render('https://a.example.com/careers');
      await vi.advanceTimersByTimeAsync(1_001);
      await expect(pending).resolves.toBeUndefined();
      expect(workers[0]!.terminated).toBe(true);
      expect(logs).toContainEqual({
        fields: { host: 'a.example.com' },
        message: 'site-render-worker-timeout',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('откат OPENQAREER_SITE_RENDER_OFF=1 и закрытые адреса не поднимают поток', async () => {
    const off = setup({ env: { OPENQAREER_SITE_RENDER_OFF: '1' } });
    await expect(off.render('https://a.example.com/careers')).resolves.toBeUndefined();
    expect(off.workers).toHaveLength(0);
    const { render, workers } = setup();
    await expect(render('http://127.0.0.1/careers')).resolves.toBeUndefined();
    expect(workers).toHaveLength(0);
  });
});
