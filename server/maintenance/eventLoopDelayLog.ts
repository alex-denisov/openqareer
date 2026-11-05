import { monitorEventLoopDelay } from 'node:perf_hooks';

/**
 * Задержка очереди событий процесса обслуживания (05.11). У Vertex таймаут 60 с, а журнал показал отказы
 * на 153 и 157 с: таймер сработал позже срока, значит, очередь держал синхронный шаг. Раз в минуту —
 * p50, p99 и максимум; отдельной строкой — каждая остановка от секунды: по соседним строкам журнала
 * видно, какой шаг её вызвал.
 */
const SUMMARY_INTERVAL_MS = 60_000;
const STALL_PROBE_MS = 250;
const STALL_THRESHOLD_MS = 1_000;
const MONITOR_RESOLUTION_MS = 20;
const NS_PER_MS = 1e6;

interface DelayLog {
  info(details: Record<string, unknown>, message: string): void;
}

export interface EventLoopDelayOptions {
  readonly summaryMs?: number;
  readonly probeMs?: number;
  readonly stallMs?: number;
}

export function startEventLoopDelayLog(
  log: DelayLog,
  options: EventLoopDelayOptions = {},
): () => void {
  const probeMs = options.probeMs ?? STALL_PROBE_MS;
  const stallMs = options.stallMs ?? STALL_THRESHOLD_MS;
  const histogram = monitorEventLoopDelay({ resolution: MONITOR_RESOLUTION_MS });
  histogram.enable();
  const summary = setInterval(() => {
    log.info(
      {
        p50Ms: Math.round(histogram.percentile(50) / NS_PER_MS),
        p99Ms: Math.round(histogram.percentile(99) / NS_PER_MS),
        maxMs: Math.round(histogram.max / NS_PER_MS),
      },
      'event-loop-delay',
    );
    histogram.reset();
  }, options.summaryMs ?? SUMMARY_INTERVAL_MS);
  summary.unref();
  let expectedAt = Date.now() + probeMs;
  const probe = setInterval(() => {
    const lateMs = Date.now() - expectedAt;
    expectedAt = Date.now() + probeMs;
    if (lateMs >= stallMs) log.info({ stallMs: lateMs }, 'event-loop-stall');
  }, probeMs);
  probe.unref();
  return () => {
    clearInterval(summary);
    clearInterval(probe);
    histogram.disable();
  };
}
