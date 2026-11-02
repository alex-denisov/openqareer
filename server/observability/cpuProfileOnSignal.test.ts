import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureCpuProfile } from './cpuProfileOnSignal';

describe('CPU profile on demand (CPO prod 02.11: what holds the event loop)', () => {
  it('writes a .cpuprofile of the busy code to the directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oq-prof-'));
    const done = captureCpuProfile({ dir, durationMs: 120 });
    const until = Date.now() + 80;
    while (Date.now() < until) Math.sqrt(Math.random());
    const file = await done;
    expect(readdirSync(dir)).toEqual([file.split('/').pop()]);
    const profile = JSON.parse(readFileSync(file, 'utf8')) as { nodes: unknown[] };
    expect(profile.nodes.length).toBeGreaterThan(1);
  });
});
