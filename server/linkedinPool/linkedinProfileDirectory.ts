import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Блокировка старше этого срока считается брошенной (B373). */
export const PROFILE_LOCK_STALE_MS = 15 * 60_000;

const ACCOUNT_ID = /^[A-Za-z0-9-]{8,64}$/u;
const LOCK_FILE = '.lock';

export type ProfileLockOwner = 'login' | 'executor';

export interface ProfileLockOptions {
  readonly now?: Date;
  readonly pid?: number;
  /** Подменяется в тестах: жив ли процесс, записавший блокировку. */
  readonly isAlive?: (pid: number) => boolean;
}

type ResolvedOptions = Required<ProfileLockOptions>;

interface LockRecord {
  readonly pid: number;
  readonly owner: string;
  readonly at: number;
}

/** `dirname(db)/linkedin-profiles/<accountId>` — рядом с базой, на постоянном диске. */
export function linkedinProfileDirectory(databasePath: string, accountId: string): string {
  if (!ACCOUNT_ID.test(accountId)) throw new Error('linkedin_profile_account_id_invalid');
  return join(dirname(databasePath), 'linkedin-profiles', accountId);
}

export function linkedinProfileExists(directory: string): boolean {
  try {
    return statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

export function ensureLinkedinProfileDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLock(directory: string): LockRecord | null {
  try {
    const record = JSON.parse(readFileSync(join(directory, LOCK_FILE), 'utf8')) as Partial<LockRecord>;
    if (
      typeof record.pid === 'number' &&
      typeof record.owner === 'string' &&
      typeof record.at === 'number'
    ) {
      return { pid: record.pid, owner: record.owner, at: record.at };
    }
    return null;
  } catch {
    return null;
  }
}

function lockIsLive(record: LockRecord | null, options: ResolvedOptions): boolean {
  if (!record) return false;
  if (options.now.getTime() - record.at > PROFILE_LOCK_STALE_MS) return false;
  return options.isAlive(record.pid);
}

function withDefaults(options: ProfileLockOptions): ResolvedOptions {
  return {
    now: options.now ?? new Date(),
    pid: options.pid ?? process.pid,
    isAlive: options.isAlive ?? processIsAlive,
  };
}

function writeLock(
  directory: string,
  owner: ProfileLockOwner,
  options: ResolvedOptions,
  flag: 'w' | 'wx',
): void {
  const record: LockRecord = { pid: options.pid, owner, at: options.now.getTime() };
  writeFileSync(join(directory, LOCK_FILE), JSON.stringify(record), { mode: 0o600, flag });
}

function tryCreateLock(directory: string, owner: ProfileLockOwner, options: ResolvedOptions): boolean {
  try {
    writeLock(directory, owner, options, 'wx');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

/** Взаимная блокировка входа и исполнителя на одном профиле. true — блокировка получена. */
export function acquireProfileLock(
  directory: string,
  owner: ProfileLockOwner,
  rawOptions: ProfileLockOptions = {},
): boolean {
  const options = withDefaults(rawOptions);
  if (tryCreateLock(directory, owner, options)) return true;
  if (lockIsLive(readLock(directory), options)) return false;
  rmSync(join(directory, LOCK_FILE), { force: true });
  return tryCreateLock(directory, owner, options);
}

/** Продлевает собственную блокировку, пока вход не простаивает. */
export function touchProfileLock(
  directory: string,
  owner: ProfileLockOwner,
  rawOptions: ProfileLockOptions = {},
): void {
  const options = withDefaults(rawOptions);
  const record = readLock(directory);
  if (record?.owner === owner && record.pid === options.pid) {
    writeLock(directory, owner, options, 'w');
  }
}

export function releaseProfileLock(directory: string, owner: ProfileLockOwner): void {
  const record = readLock(directory);
  if (record && record.owner !== owner) return;
  rmSync(join(directory, LOCK_FILE), { force: true });
}
