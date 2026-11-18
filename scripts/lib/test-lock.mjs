// Общая на машину очередь тяжёлых локальных проверок (Playwright): несколько
// worktree на одном Mac не гоняют e2e одновременно. Блокировка — каталог
// ~/.cache/openqareer/<name>.lock (mkdir атомарен) с owner.json {pid, cwd}.
// Каталог умершего процесса снимается сам. В CI и при OQ_NO_LOCK=1 не действует.
// OQ_LOCK_HELD=<pid> передаёт уже взятую блокировку дочерним процессам.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_LOCK_DIR = path.join(os.homedir(), '.cache', 'openqareer');
const POLL_MS = 1000;
const REPORT_EVERY_MS = 10_000;
const sleepCell = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms) {
  Atomics.wait(sleepCell, 0, 0, ms);
}

export function lockDisabled(env = process.env) {
  return Boolean(env.CI && env.CI !== 'false') || env.OQ_NO_LOCK === '1';
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

function readOwner(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

function lockAge(lockPath) {
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs;
  } catch {
    return 0;
  }
}

// Снимает блокировку, если её владелец мёртв. Каталог без owner.json старше
// 5 с считается брошенным (процесс умер между mkdir и записью владельца).
function removeIfStale(lockPath) {
  const owner = readOwner(lockPath);
  const stale = owner ? !isAlive(owner.pid) : lockAge(lockPath) > 5000;
  if (!stale) return owner;
  const grave = `${lockPath}.stale-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(lockPath, grave);
    fs.rmSync(grave, { recursive: true, force: true });
  } catch {
    // Другой процесс успел снять или взять её — следующий круг разберётся.
  }
  return null;
}

function tryAcquire(lockPath) {
  try {
    fs.mkdirSync(lockPath);
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  const owner = { pid: process.pid, cwd: process.cwd(), started: new Date().toISOString() };
  fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify(owner));
  return true;
}

const NOOP = Object.freeze({ acquired: false, release() {} });

/**
 * Берёт блокировку синхронно, ожидая очереди. Возвращает {acquired, release}.
 * @param {{name?: string, dir?: string, env?: NodeJS.ProcessEnv, log?: (s: string) => void,
 *   pollMs?: number, timeoutMs?: number}} [options]
 */
export function acquireTestLock(options = {}) {
  const env = options.env ?? process.env;
  if (lockDisabled(env)) return NOOP;
  const held = Number(env.OQ_LOCK_HELD);
  if (held && isAlive(held)) return NOOP;
  const dir = options.dir ?? DEFAULT_LOCK_DIR;
  const lockPath = path.join(dir, `${options.name ?? 'playwright'}.lock`);
  const log = options.log ?? ((s) => console.error(s));
  const pollMs = options.pollMs ?? POLL_MS;
  fs.mkdirSync(dir, { recursive: true });
  const started = Date.now();
  let lastReport = -Infinity;
  while (!tryAcquire(lockPath)) {
    const owner = removeIfStale(lockPath);
    const waited = Date.now() - started;
    if (options.timeoutMs !== undefined && waited >= options.timeoutMs)
      throw new Error(`очередь тестов: не дождался ${lockPath} за ${waited} мс`);
    if (owner && waited - lastReport >= REPORT_EVERY_MS) {
      lastReport = waited;
      log(`жду очереди: занято ${owner.pid} ${owner.cwd} ${Math.round(waited / 1000)} с`);
    }
    if (owner) sleepSync(pollMs);
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    if (readOwner(lockPath)?.pid === process.pid)
      fs.rmSync(lockPath, { recursive: true, force: true });
  };
  process.once('exit', release);
  return { acquired: true, lockPath, release };
}
