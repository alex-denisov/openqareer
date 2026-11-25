import { describe, expect, it } from 'vitest';
import { summarizeCpuProfile, type CpuProfile } from './cpuProfileTop';

const frame = (
  functionName: string,
  lineNumber: number,
  columnNumber = 0,
  url = 'file:///srv/m.mjs',
) => ({
  functionName,
  url,
  lineNumber,
  columnNumber,
});

/** root → wave → parse (горячая) и root → wave → write; плюс сборщик мусора. */
const profile: CpuProfile = {
  nodes: [
    { id: 1, callFrame: frame('(root)', -1), children: [2, 5] },
    { id: 2, callFrame: frame('wave', 10), children: [3, 4] },
    { id: 3, callFrame: frame('parse', 20, 5) },
    { id: 4, callFrame: frame('write', 30) },
    { id: 5, callFrame: frame('(garbage collector)', -1, -1, '') },
  ],
  startTime: 0,
  endTime: 10_000_000,
  samples: [3, 3, 3, 3, 3, 3, 4, 4, 5, 2],
  timeDeltas: Array.from({ length: 10 }, () => 1_000_000),
};

describe('B761: верх профиля процессора', () => {
  it('самое долгое собственное время — первым, с долей и цепочкой вызова', () => {
    const top = summarizeCpuProfile(profile, { top: 3 });
    expect(top.profiledMs).toBe(10_000);
    expect(top.entries[0]).toMatchObject({
      fn: 'parse',
      at: 'm.mjs:21:6',
      selfMs: 6_000,
      share: 0.6,
      chain: 'wave m.mjs:11:1',
    });
    expect(top.entries.map((entry) => entry.fn)).toEqual(['parse', 'write', '(garbage collector)']);
  });

  it('кусок кода у места вызова — по строке и столбцу файла бандла', () => {
    const lines = ['', ...Array.from({ length: 25 }, (_, i) => `line${i + 1}`)];
    lines[20] = 'aaaaaSELECT * FROM vacancy_clusters WHERE x';
    const top = summarizeCpuProfile(profile, { top: 1, source: () => lines, snippetChars: 12 });
    expect(top.entries[0]!.snippet).toBe('SELECT * FRO');
  });

  it('пустой профиль — пустой верх', () => {
    const top = summarizeCpuProfile({ ...profile, samples: [], timeDeltas: [] }, { top: 5 });
    expect(top.entries).toEqual([]);
    expect(top.profiledMs).toBe(0);
  });
});

describe('B761: живой профиль в этом процессе', () => {
  it('находит синхронную функцию, которая держит цикл', async () => {
    const { startCpuProfileLog } = await import('./cpuProfileTop');
    const lines: Array<{ details: Record<string, unknown>; message: string }> = [];
    const done = new Promise<void>((resolve) => {
      startCpuProfileLog(
        {
          info: (details, message) => {
            lines.push({ details, message });
            resolve();
          },
          warn: (details, message) => {
            lines.push({ details, message });
            resolve();
          },
        },
        { firstDelayMs: 0, durationMs: 400, top: 5, env: {} },
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const started = Date.now();
    let sink = 0;
    function busyB761Loop(): void {
      while (Date.now() - started < 300) sink += Math.sqrt(sink + 1);
    }
    busyB761Loop();
    await done;
    expect(lines[0]!.message).toBe('cpu-profile-top');
    const entries = lines[0]!.details.entries as Array<{ fn: string; chain: string }>;
    expect(entries.some((entry) => `${entry.fn} ${entry.chain}`.includes('busyB761Loop'))).toBe(
      true,
    );
    expect(sink).toBeGreaterThan(0);
  });

  it('B759: снимает первую минуту сразу, не дожидаясь срока', async () => {
    const { startCpuProfileLog } = await import('./cpuProfileTop');
    const message = await new Promise<string>((resolve) => {
      startCpuProfileLog(
        { info: (_, text) => resolve(text), warn: (_, text) => resolve(text) },
        { firstDelayMs: 60_000, durationMs: 20, atStart: true, env: {} },
      );
    });
    expect(message).toBe('cpu-profile-top');
  });

  it('B759: остановка отменяет идущий профиль без записи в журнал', async () => {
    const { startCpuProfileLog } = await import('./cpuProfileTop');
    const messages: string[] = [];
    const push = (_: unknown, text: string) => messages.push(text);
    const stop = startCpuProfileLog(
      { info: push, warn: push },
      { firstDelayMs: 60_000, durationMs: 50, atStart: true, env: {} },
    );
    stop();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(messages).toEqual([]);
  });
});
