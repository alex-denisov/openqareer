import type { CandidateSnapshot, AccountSnapshot } from '../coach/coachApi';
import type { ResumeStudioView } from '../resume/resumeTypes';

const CACHE_PREFIX = 'openqareer:cabinet:v1:';

export interface CareerCabinetCacheValue {
  readonly account: AccountSnapshot;
  readonly snapshot: CandidateSnapshot;
  readonly resume?: ResumeStudioView;
}

interface StoredCareerCabinetCache extends CareerCabinetCacheValue {
  readonly version: 1;
  readonly candidateId: string;
}

export function readCareerCabinetCache(
  storage: Storage,
  candidateId: string,
): CareerCabinetCacheValue | undefined {
  try {
    const raw = storage.getItem(cacheKey(candidateId));
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    return isStoredCache(value, candidateId) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function writeCareerCabinetCache(
  storage: Storage,
  candidateId: string,
  value: CareerCabinetCacheValue,
): void {
  if (!candidateId || value.snapshot.candidate.id !== candidateId) return;
  try {
    const stored: StoredCareerCabinetCache = { ...value, version: 1, candidateId };
    storage.setItem(cacheKey(candidateId), JSON.stringify(stored));
  } catch {
    // The cache is an optimization; a quota or privacy restriction must not
    // prevent the server profile from loading.
  }
}

export function clearCareerCabinetCache(storage?: Storage): void {
  try {
    const target = storage ?? (typeof window !== 'undefined' ? window.sessionStorage : undefined);
    if (!target) return;
    for (let index = target.length - 1; index >= 0; index -= 1) {
      const key = target.key(index);
      if (key?.startsWith(CACHE_PREFIX)) target.removeItem(key);
    }
  } catch {
    // Signing out must continue even when the browser blocks storage access.
  }
}

function cacheKey(candidateId: string): string {
  return `${CACHE_PREFIX}${encodeURIComponent(candidateId)}`;
}

function isStoredCache(value: unknown, candidateId: string): value is StoredCareerCabinetCache {
  if (!isRecord(value) || value.version !== 1 || value.candidateId !== candidateId) return false;
  if (!isRecord(value.account) || !isRecord(value.account.profile)) return false;
  if (!isRecord(value.snapshot) || !Array.isArray(value.snapshot.memory)) return false;
  if (!isRecord(value.snapshot.candidate) || value.snapshot.candidate.id !== candidateId) {
    return false;
  }
  return value.resume === undefined || isRecord(value.resume);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
