import { expect, it } from 'vitest';
import { MultiSourceVacancyEngine } from './multiSourceVacancyEngine';
import type { VacancySourceConfig } from '../domain/unifiedVacancy';

function board(index: number): VacancySourceConfig {
  return {
    id: `ats-greenhouse-board${index}`,
    name: `Board ${index}`,
    type: 'json_api',
    enabled: true,
    targetUrl: `https://boards-api.greenhouse.io/v1/boards/board${index}/jobs`,
    refreshIntervalMinutes: 720,
    itemsFoundTotal: 0,
    itemsActiveTotal: 0,
  };
}

it('B759: после отмены волна не берёт новые площадки', async () => {
  const stop = new AbortController();
  const asked: string[] = [];
  const engine = new MultiSourceVacancyEngine({
    sources: Array.from({ length: 80 }, (_, index) => board(index)),
    signal: stop.signal,
    fetcher: async (source) => {
      asked.push(source.id);
      stop.abort();
      return [];
    },
  });
  await engine.syncDue();
  const beforeStop = asked.length;
  await engine.syncDue();
  expect(asked).toHaveLength(beforeStop);
  const all = await engine.syncSource('ats-greenhouse-board79');
  expect(all.status).toBe('stopped');
});

/** Фетчер, который сообщает о начале чтения. */
function announce<T>(read: () => Promise<T>) {
  let begin!: () => void;
  const started = new Promise<void>((resolve) => (begin = resolve));
  return { started, fetcher: () => (begin(), read()) };
}

it('B759: зависшее чтение не держит остановку и не пишет площадке отказ', async () => {
  const stop = new AbortController();
  const { started, fetcher } = announce(() => new Promise<never>(() => undefined));
  const engine = new MultiSourceVacancyEngine({
    sources: [board(1)],
    signal: stop.signal,
    stopReadingGraceMs: 10,
    fetcher,
  });
  const wave = engine.syncDue();
  await started;
  stop.abort();
  expect((await wave).map((outcome) => outcome.status)).toEqual(['stopped']);
  expect(engine.getSources()[0]!.lastStatus).toBeUndefined();
});

it('B759: обход, отдавший прочитанное после отмены, записывается', async () => {
  const stop = new AbortController();
  const { started, fetcher } = announce(
    () => new Promise<[]>((resolve) => stop.signal.addEventListener('abort', () => resolve([]))),
  );
  const engine = new MultiSourceVacancyEngine({
    sources: [board(1)],
    signal: stop.signal,
    stopReadingGraceMs: 1_000,
    fetcher,
  });
  const wave = engine.syncDue();
  await started;
  stop.abort();
  expect((await wave).map((outcome) => outcome.status)).toEqual(['healthy']);
});
