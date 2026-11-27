import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MEMORY_LIMITS = {
  heapLimitBytes: 640 * 1024 * 1024,
  rssLimitBytes: 900 * 1024 * 1024,
} as const;

export interface MemorySample {
  readonly heapUsed: number;
  readonly rss: number;
  readonly external: number;
}

export function sampleMemory(): MemorySample {
  if (typeof global.gc === 'function') global.gc();
  const usage = process.memoryUsage();
  return { heapUsed: usage.heapUsed, rss: usage.rss, external: usage.external };
}

export interface MemoryTracker {
  record(): MemorySample;
  readonly baselineHeapBytes: number;
  readonly peakHeapBytes: number;
  readonly peakRssBytes: number;
  readonly deltaHeapBytes: number;
}

export function createMemoryTracker(): MemoryTracker {
  const baseline = sampleMemory();
  let peakHeap = baseline.heapUsed;
  let peakRss = baseline.rss;
  return {
    record: () => {
      const current = sampleMemory();
      if (current.heapUsed > peakHeap) peakHeap = current.heapUsed;
      if (current.rss > peakRss) peakRss = current.rss;
      return current;
    },
    get baselineHeapBytes() {
      return baseline.heapUsed;
    },
    get peakHeapBytes() {
      return peakHeap;
    },
    get peakRssBytes() {
      return peakRss;
    },
    get deltaHeapBytes() {
      return Math.max(0, peakHeap - baseline.heapUsed);
    },
  };
}

export interface MemoryWorkerReport {
  readonly exitCode: number;
  readonly peakHeapBytes: number;
  readonly peakRssBytes: number;
  readonly baselineHeapBytes: number;
  readonly queueDelta2kBytes: number;
  readonly queueDelta20kBytes: number;
  readonly poolSyncDeltaBytes: number;
  readonly pruneDeltaBytes: number;
  readonly promoteDeltaBytes: number | null;
  readonly durationMs: number;
  readonly stderr: string;
}

function resolveTsxCli(): string {
  return resolve(process.cwd(), 'node_modules/tsx/dist/cli.mjs');
}

function resolveWorkerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, 'memoryWorker.ts');
}

export function runMemoryWorkerSubprocess(
  dbDir: string,
  rows2k = 2_000,
  rows20k = 20_000,
): Promise<MemoryWorkerReport> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      ['--expose-gc', resolveTsxCli(), resolveWorkerPath(), dbDir, String(rows2k), String(rows20k)],
      {
        cwd: process.cwd(),
        env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=640' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', rejectPromise);
    child.on('close', (code) => {
      const lastLine = stdout.trim().split('\n').filter(Boolean).at(-1) ?? '{}';
      try {
        const parsed = JSON.parse(lastLine) as Omit<MemoryWorkerReport, 'exitCode' | 'stderr'>;
        resolvePromise({ ...parsed, exitCode: code ?? 1, stderr });
      } catch {
        resolvePromise({
          exitCode: code ?? 1,
          peakHeapBytes: Number.MAX_SAFE_INTEGER,
          peakRssBytes: Number.MAX_SAFE_INTEGER,
          baselineHeapBytes: 0,
          queueDelta2kBytes: 0,
          queueDelta20kBytes: 0,
          poolSyncDeltaBytes: 0,
          pruneDeltaBytes: 0,
          promoteDeltaBytes: null,
          durationMs: 0,
          stderr: `${stderr}\nstdout: ${stdout}`,
        });
      }
    });
  });
}
