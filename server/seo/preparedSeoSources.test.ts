import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { emptySeoPreparedSnapshot } from '../../shared/seoSourceSnapshot';
import { readPreparedSeoSources, SEO_SNAPSHOT_MAX_BYTES } from './preparedSeoSources';

const directories: string[] = [];
afterEach(() => directories.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })));
function file(data: string) {
  const directory = mkdtempSync(join(tmpdir(), 'oq-seo-prepared-')); directories.push(directory);
  const path = join(directory, 'safe.json'); writeFileSync(path, data); return path;
}

describe('bounded prepared SEO source reader', () => {
  it('keeps missing, relative, malformed, oversized and wrong-origin sources unavailable', () => {
    expect(readPreparedSeoSources().google.status).toBe('unavailable');
    expect(readPreparedSeoSources('relative.json').google.status).toBe('unavailable');
    for (const data of ['bad-json', ' '.repeat(SEO_SNAPSHOT_MAX_BYTES + 1), JSON.stringify({ ...emptySeoPreparedSnapshot(), propertyOrigin: 'https://example.test' })]) {
      expect(readPreparedSeoSources(file(data)).google.status).toBe('unavailable');
    }
  });
  it('rejects symlinks/directories and caches bounded parsed content without a network fallback', () => {
    const snapshot = emptySeoPreparedSnapshot();
    const path = file(JSON.stringify(snapshot));
    const link = path + '.link'; symlinkSync(path, link);
    expect(readPreparedSeoSources(link).google.status).toBe('unavailable');
    expect(readPreparedSeoSources(join(path, '..')).google.status).toBe('unavailable');
    const now = Date.now();
    expect(readPreparedSeoSources(path, now).google.latestAttempt).toBeNull();
    snapshot.providers.google.latestAttempt = { observedAt: new Date(now).toISOString(), mode: 'operational_check', status: 'unavailable', reason: 'credentials_missing' };
    writeFileSync(path, JSON.stringify(snapshot));
    expect(readPreparedSeoSources(path, now + 1).google.latestAttempt).toBeNull();
    expect(readPreparedSeoSources(path, now + 10_001).google.latestAttempt?.reason).toBe('credentials_missing');
  });
  it('rejects future timestamps and synthetic fixture payloads', () => {
    const now = Date.now(); const snapshot = emptySeoPreparedSnapshot(new Date(now + 400_000).toISOString());
    expect(readPreparedSeoSources(file(JSON.stringify(snapshot)), now).google.status).toBe('unavailable');
    expect(readPreparedSeoSources(file(JSON.stringify({ ...emptySeoPreparedSnapshot(), mode: 'synthetic_fixture' }))).google.status).toBe('unavailable');
  });
});
