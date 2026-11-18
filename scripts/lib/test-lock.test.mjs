import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquireTestLock, lockDisabled } from './test-lock.mjs';

const LOCAL = { HOME: os.homedir() };
let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oq-lock-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const lockPath = () => path.join(dir, 'playwright.lock');
const owner = () => JSON.parse(fs.readFileSync(path.join(lockPath(), 'owner.json'), 'utf8'));

function holdInChild(ms) {
  const code = `
    import { acquireTestLock } from ${JSON.stringify(path.resolve('scripts/lib/test-lock.mjs'))};
    acquireTestLock({ dir: ${JSON.stringify(dir)}, env: {} });
    console.log('held');
    setTimeout(() => {}, ${ms});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code]);
  return new Promise((resolve) => child.stdout.once('data', () => resolve(child)));
}

describe('acquireTestLock', () => {
  it('берёт свободную блокировку и снимает её', () => {
    const lock = acquireTestLock({ dir, env: LOCAL });
    expect(lock.acquired).toBe(true);
    expect(owner().pid).toBe(process.pid);
    lock.release();
    expect(fs.existsSync(lockPath())).toBe(false);
  });

  it('ждёт живого владельца и пишет строку очереди', async () => {
    const child = await holdInChild(60_000);
    const lines = [];
    expect(() =>
      acquireTestLock({ dir, env: LOCAL, pollMs: 50, timeoutMs: 300, log: (s) => lines.push(s) }),
    ).toThrow(/не дождался/u);
    expect(lines[0]).toMatch(new RegExp(`^жду очереди: занято ${child.pid} `, 'u'));
    child.kill('SIGKILL');
  });

  it('снимает блокировку умершего процесса', () => {
    const dead = spawnSync(process.execPath, ['-e', 'process.pid']).pid;
    fs.mkdirSync(lockPath(), { recursive: true });
    fs.writeFileSync(path.join(lockPath(), 'owner.json'), JSON.stringify({ pid: dead, cwd: '/x' }));
    const lock = acquireTestLock({ dir, env: LOCAL, pollMs: 10, timeoutMs: 1000 });
    expect(lock.acquired).toBe(true);
    expect(owner().pid).toBe(process.pid);
    lock.release();
  });

  it('после выхода держателя очередь проходит', async () => {
    const child = await holdInChild(200);
    const lock = acquireTestLock({ dir, env: LOCAL, pollMs: 20, timeoutMs: 5000, log: () => {} });
    expect(lock.acquired).toBe(true);
    lock.release();
    child.kill();
  });

  it('обходится в CI, при OQ_NO_LOCK=1 и при живом OQ_LOCK_HELD', () => {
    expect(lockDisabled({ CI: 'true' })).toBe(true);
    expect(lockDisabled({ OQ_NO_LOCK: '1' })).toBe(true);
    expect(lockDisabled({})).toBe(false);
    for (const env of [{ CI: 'true' }, { OQ_NO_LOCK: '1' }, { OQ_LOCK_HELD: String(process.pid) }])
      expect(acquireTestLock({ dir, env }).acquired).toBe(false);
    expect(fs.existsSync(lockPath())).toBe(false);
  });
});
