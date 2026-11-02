import { writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { join } from 'node:path';

export interface CpuProfileOptions {
  readonly dir?: string;
  readonly durationMs?: number;
}

/**
 * Samples the whole process for a while and writes a `.cpuprofile` (Chrome DevTools format).
 * Prod 02.11: a 44 s event-loop stall had no request doing work, so the culprit has to be
 * found in the samples, not in request logs.
 */
export async function captureCpuProfile(options: CpuProfileOptions = {}): Promise<string> {
  const { dir = '/tmp', durationMs = 30_000 } = options;
  const session = new Session();
  session.connect();
  try {
    await session.post('Profiler.enable');
    await session.post('Profiler.start');
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const { profile } = await session.post('Profiler.stop');
    const file = join(dir, `openqareer-${process.pid}-${Date.now()}.cpuprofile`);
    writeFileSync(file, JSON.stringify(profile));
    return file;
  } finally {
    session.disconnect();
  }
}

/** `kill -USR2 <pid>` writes one 30 s profile to /tmp; a second signal while running is ignored. */
export function captureCpuProfileOnSignal(log: (fields: object, message: string) => void): void {
  let running = false;
  process.on('SIGUSR2', () => {
    if (running) return;
    running = true;
    void captureCpuProfile()
      .then((file) => log({ file }, 'cpu-profile-written'))
      .catch((error: unknown) =>
        log(
          { errorName: error instanceof Error ? error.name : 'UnknownError' },
          'cpu-profile-failed',
        ),
      )
      .finally(() => {
        running = false;
      });
  });
}
