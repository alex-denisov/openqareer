import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDiskCapacity } from './diskCapacity';

describe('readDiskCapacity', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('returns undefined for :memory: or missing database path', () => {
    expect(readDiskCapacity(undefined)).toBeUndefined();
    expect(readDiskCapacity(':memory:')).toBeUndefined();
    expect(readDiskCapacity('/nonexistent-path-oq/missing.db')).toBeUndefined();
  });

  it('reads db, wal, and disk headroom and flags diskLow when threshold exceeds free space', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oq-disk-cap-'));
    dirs.push(dir);
    const dbPath = join(dir, 'openqareer.db');
    writeFileSync(dbPath, Buffer.alloc(2 * 1024 * 1024, 1));
    writeFileSync(`${dbPath}-wal`, Buffer.alloc(1024 * 1024, 2));

    const normal = readDiskCapacity(dbPath, { minFreeMb: 1, minFreePct: 0.1 });
    expect(normal).toBeDefined();
    expect(normal?.dbSizeMb).toBe(2);
    expect(normal?.walSizeMb).toBe(1);
    expect(normal?.diskFreeMb).toBeGreaterThan(0);
    expect(normal?.diskFreePct).toBeGreaterThan(0);
    expect(normal?.diskLow).toBe(false);

    const low = readDiskCapacity(dbPath, { minFreeMb: 100_000_000, minFreePct: 99.9 });
    expect(low?.diskLow).toBe(true);
  });
});
