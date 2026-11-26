import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { queueDueRaises, STALE_RUNNING_MS } from './hhRaiseQueue';
import { SqliteHhRaiseRepository } from './sqliteHhRaiseRepository';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function repository(): SqliteHhRaiseRepository {
  const dir = mkdtempSync(join(tmpdir(), 'hh-raise-'));
  dirs.push(dir);
  return new SqliteHhRaiseRepository({ databasePath: join(dir, 'db.sqlite') });
}

describe('queueDueRaises', () => {
  const t0 = new Date('2026-11-19T10:00:00.000Z');

  it('брошенное клиентом задание закрывается через 15 минут, и резюме снова встаёт в очередь', () => {
    const repo = repository();
    repo.enqueue('c1', 'r1', t0.toISOString());
    expect(repo.claim('c1', t0.toISOString())).not.toBeNull();
    expect(repo.hasOpenTask('c1', 'r1')).toBe(true);

    const early = new Date(t0.getTime() + STALE_RUNNING_MS - 1_000);
    queueDueRaises(repo, early, () => true);
    expect(repo.hasOpenTask('c1', 'r1')).toBe(true);

    const late = new Date(t0.getTime() + STALE_RUNNING_MS + 1_000);
    queueDueRaises(repo, late, () => true);
    expect(repo.hasOpenTask('c1', 'r1')).toBe(false);
  });
});
