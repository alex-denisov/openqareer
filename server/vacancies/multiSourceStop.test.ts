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

/** Чтение, которое отдаёт улов только на отмене. */
const onAbort = <T>(signal: AbortSignal, value: T) =>
  new Promise<T>((resolve) => signal.addEventListener('abort', () => resolve(value)));

function stoppable(answer: never[] | { vacancies: never[]; partial: boolean }) {
  const stop = new AbortController();
  const { started, fetcher } = announce(() => onAbort(stop.signal, answer));
  const engine = new MultiSourceVacancyEngine({
    sources: [board(1)],
    signal: stop.signal,
    stopReadingGraceMs: 1_000,
    fetcher,
  });
  return { stop, started, engine };
}

it.each([
  [
    'частичный обход, уже сдвинувший курсор, записывается',
    { vacancies: [], partial: true },
    'healthy',
  ],
  ['полное чтение не записывается — его повторит следующий старт', [], 'stopped'],
] as const)('B759: %s', async (_, answer, status) => {
  const { stop, started, engine } = stoppable(answer as never);
  const wave = engine.syncDue();
  await started;
  stop.abort();
  expect((await wave).map((outcome) => outcome.status)).toEqual([status]);
});

it('B759: зависший robots.txt не держит остановку', async () => {
  const stop = new AbortController();
  const asked = announce(() => new Promise<never>(() => undefined));
  const engine = new MultiSourceVacancyEngine({
    sources: [board(1)],
    signal: stop.signal,
    robots: { policyFor: asked.fetcher } as never,
    fetcher: async () => [],
  });
  const wave = engine.syncDue();
  await asked.started;
  stop.abort();
  expect((await wave).map((outcome) => outcome.status)).toEqual(['stopped']);
});

it('B759: зависшая проверка ссылок не держит остановку, после неё новая не начинается', async () => {
  const stop = new AbortController();
  const probe = announce(() => new Promise<never>(() => undefined));
  const links = [{ id: 'v1', url: 'https://example.com/1', postedAt: new Date().toISOString() }];
  const engine = new MultiSourceVacancyEngine({
    sources: [board(1)],
    signal: stop.signal,
    linkProbe: probe.fetcher as never,
  });
  (engine as unknown as { pool: { loadSourceLinks: unknown } }).pool.loadSourceLinks = () => links;
  const probing = engine.probeSourceLinks(board(1).id);
  await probe.started;
  stop.abort();
  expect(await probing).toBeUndefined();
  expect(await engine.probeUnseenEmployerLinks()).toMatchObject({ checked: 0 });
});
