import { readFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { fileURLToPath } from 'node:url';

/**
 * B761 23.11: процесс обслуживания стоит ~30 % времени (стоянки до 26 с), а
 * `maintenance-step-timing` объясняет синхронными шагами только половину.
 * Источник показывает только профиль процессора: раз в час минуту пишем
 * профиль в этом же процессе (выборки снимает поток профилировщика V8, пока
 * основной поток занят) и выводим в журнал верх функций по собственному
 * времени. Бандл сжат и без карты, поэтому рядом с местом — кусок его кода:
 * SQL и строки в нём узнаются без исходников.
 */

interface CallFrame {
  readonly functionName: string;
  readonly url: string;
  readonly lineNumber: number;
  readonly columnNumber: number;
}

interface ProfileNode {
  readonly id: number;
  readonly callFrame: CallFrame;
  readonly children?: readonly number[];
}

export interface CpuProfile {
  readonly nodes: readonly ProfileNode[];
  readonly startTime: number;
  readonly endTime: number;
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}

export interface CpuProfileEntry {
  readonly fn: string;
  readonly at: string;
  readonly selfMs: number;
  readonly share: number;
  /** Самая частая цепочка вызова, до трёх кадров вверх. */
  readonly chain: string;
  readonly snippet?: string;
}

export interface CpuProfileTop {
  readonly profiledMs: number;
  readonly entries: readonly CpuProfileEntry[];
}

export interface SummarizeOptions {
  readonly top: number;
  /** Строки файла по адресу кадра; нет — без куска кода. */
  readonly source?: (url: string) => readonly string[] | undefined;
  readonly snippetChars?: number;
}

const CHAIN_DEPTH = 3;
const DEFAULT_SNIPPET_CHARS = 120;

const shortUrl = (url: string): string => url.slice(url.lastIndexOf('/') + 1);

function place(frame: CallFrame): string {
  if (frame.lineNumber < 0) return shortUrl(frame.url);
  return `${shortUrl(frame.url)}:${frame.lineNumber + 1}:${frame.columnNumber + 1}`;
}

const label = (frame: CallFrame): string =>
  `${frame.functionName || '(anonymous)'} ${place(frame)}`;

function chainOf(id: number, parents: ReadonlyMap<number, ProfileNode>): string {
  const links: string[] = [];
  let parent = parents.get(id);
  while (parent && parent.callFrame.functionName !== '(root)' && links.length < CHAIN_DEPTH) {
    links.push(label(parent.callFrame));
    parent = parents.get(parent.id);
  }
  return links.join(' < ');
}

function snippetOf(frame: CallFrame, options: SummarizeOptions): string | undefined {
  if (!options.source || frame.lineNumber < 0) return undefined;
  const line = options.source(frame.url)?.[frame.lineNumber];
  if (line === undefined) return undefined;
  const start = Math.max(0, frame.columnNumber);
  return line.slice(start, start + (options.snippetChars ?? DEFAULT_SNIPPET_CHARS));
}

interface Tally {
  readonly frame: CallFrame;
  selfUs: number;
  readonly chains: Map<string, number>;
}

function tallySamples(profile: CpuProfile): { tallies: Map<string, Tally>; totalUs: number } {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, ProfileNode>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parents.set(child, node);
  const tallies = new Map<string, Tally>();
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];
  let totalUs = 0;
  samples.forEach((id, index) => {
    const node = byId.get(id);
    const us = deltas[index] ?? 0;
    if (!node) return;
    totalUs += us;
    const key = label(node.callFrame);
    const tally = tallies.get(key) ?? { frame: node.callFrame, selfUs: 0, chains: new Map() };
    tally.selfUs += us;
    const chain = chainOf(id, parents);
    tally.chains.set(chain, (tally.chains.get(chain) ?? 0) + us);
    tallies.set(key, tally);
  });
  return { tallies, totalUs };
}

const topChain = (chains: ReadonlyMap<string, number>): string =>
  [...chains.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';

export function summarizeCpuProfile(profile: CpuProfile, options: SummarizeOptions): CpuProfileTop {
  const { tallies, totalUs } = tallySamples(profile);
  const entries = [...tallies.values()]
    .sort((a, b) => b.selfUs - a.selfUs)
    .slice(0, options.top)
    .map((tally): CpuProfileEntry => {
      const snippet = snippetOf(tally.frame, options);
      return {
        fn: tally.frame.functionName || '(anonymous)',
        at: place(tally.frame),
        selfMs: Math.round(tally.selfUs / 1_000),
        share: totalUs > 0 ? Math.round((tally.selfUs / totalUs) * 1_000) / 1_000 : 0,
        chain: topChain(tally.chains),
        ...(snippet !== undefined ? { snippet } : {}),
      };
    });
  return { profiledMs: Math.round(totalUs / 1_000), entries };
}

interface ProfileLog {
  info(details: Record<string, unknown>, message: string): void;
  warn(details: Record<string, unknown>, message: string): void;
}

export interface CpuProfileLogOptions {
  readonly firstDelayMs?: number;
  readonly everyMs?: number;
  readonly durationMs?: number;
  readonly top?: number;
  readonly env?: NodeJS.ProcessEnv;
}

const HOUR_MS = 60 * 60_000;

function bundleSource(): (url: string) => readonly string[] | undefined {
  const cache = new Map<string, readonly string[] | undefined>();
  return (url) => {
    if (!url.startsWith('file:')) return undefined;
    if (!cache.has(url)) {
      try {
        cache.set(url, readFileSync(fileURLToPath(url), 'utf8').split('\n'));
      } catch {
        cache.set(url, undefined);
      }
    }
    return cache.get(url);
  };
}

async function profileOnce(durationMs: number): Promise<CpuProfile> {
  const session = new Session();
  session.connect();
  try {
    await session.post('Profiler.enable');
    await session.post('Profiler.setSamplingInterval', { interval: 1_000 });
    await session.post('Profiler.start');
    await new Promise((resolve) => setTimeout(resolve, durationMs).unref());
    const { profile } = await session.post('Profiler.stop');
    return profile as CpuProfile;
  } finally {
    session.disconnect();
  }
}

/** Минута профиля через `firstDelayMs`, дальше раз в `everyMs`. Откат: OPENQAREER_CPU_PROFILE_OFF=1. */
export function startCpuProfileLog(
  log: ProfileLog,
  options: CpuProfileLogOptions = {},
): () => void {
  const env = options.env ?? process.env;
  if (env.OPENQAREER_CPU_PROFILE_OFF?.trim() === '1') return () => undefined;
  const durationMs = options.durationMs ?? 60_000;
  const source = bundleSource();
  const run = (): void => {
    profileOnce(durationMs).then(
      (profile) =>
        log.info(
          { ...summarizeCpuProfile(profile, { top: options.top ?? 25, source }) },
          'cpu-profile-top',
        ),
      (error: unknown) =>
        log.warn(
          { errorName: error instanceof Error ? error.name : 'Error' },
          'cpu-profile-failed',
        ),
    );
  };
  let every: NodeJS.Timeout | undefined;
  const first = setTimeout(
    () => {
      run();
      every = setInterval(run, options.everyMs ?? HOUR_MS);
      every.unref();
    },
    options.firstDelayMs ?? 15 * 60_000,
  );
  first.unref();
  return () => {
    clearTimeout(first);
    if (every) clearInterval(every);
  };
}
