import { describe, expect, it, vi } from 'vitest';
import { startEventLoopDelayLog } from './eventLoopDelayLog';

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function blockFor(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until);
}

describe('задержка очереди событий', () => {
  it('сводка показывает задержку, остановка пишется отдельной строкой', async () => {
    const log = { info: vi.fn() };
    const stop = startEventLoopDelayLog(log, { summaryMs: 400, probeMs: 20, stallMs: 100 });
    await pause(40);
    blockFor(250);
    await pause(300);
    stop();

    const lines = log.info.mock.calls as unknown as [Record<string, number>, string][];
    const stalls = lines.filter(([, message]) => message === 'event-loop-stall');
    const summaries = lines.filter(([, message]) => message === 'event-loop-delay');
    expect(stalls.length).toBeGreaterThan(0);
    expect(stalls[0]![0].stallMs).toBeGreaterThanOrEqual(100);
    expect(summaries.some(([details]) => details.maxMs! >= 100)).toBe(true);
  });

  it('после остановки строк нет', async () => {
    const log = { info: vi.fn() };
    const stop = startEventLoopDelayLog(log, { summaryMs: 10, probeMs: 5 });
    stop();
    await pause(40);
    expect(log.info).not.toHaveBeenCalled();
  });
});
