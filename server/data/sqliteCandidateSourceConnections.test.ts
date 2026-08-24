import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EMPTY_RESUME_DRAFT } from '../domain/resumeDraft';
import {
  createCandidate,
  createStore,
  directories,
  stores,
} from './sqliteTestHarness';

const sourceUrl = 'https://hh.ru/resume/synthetic-source-731';

function commitInput(
  overrides: { sourceUrl?: string; memoryId?: string; importDigest?: string } = {},
) {
  return {
    evidence: {
      sourceLabel: 'Импорт: резюме hh.ru',
      entries: [
        {
          memoryId: overrides.memoryId ?? 'native-hh-result-1',
          domain: 'outcome' as const,
          statement: 'Запустил продукт и сократил срок релиза.',
        },
      ],
    },
    draft: EMPTY_RESUME_DRAFT,
    sourceReceipt: {
      platform: 'hh' as const,
      accessMode: 'native_session_snapshot' as const,
      sourceUrl: overrides.sourceUrl ?? sourceUrl,
      capturedAt: '2026-08-23T12:00:00.000Z',
      importDigest: overrides.importDigest ?? 'a'.repeat(64),
    },
  };
}

describe('SQLite native candidate source connections', () => {
  it('persists a tenant-scoped encrypted receipt across a store reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-native-source-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidate = createCandidate(store);
    const other = createCandidate(store);

    store.commitResumeImport(candidate.id, commitInput());
    expect(store.listNativeSourceConnections(other.id)).toEqual([]);
    expect(store.listNativeSourceConnections(candidate.id)[0]).toMatchObject({
      candidateId: candidate.id,
      platform: 'hh',
      accessMode: 'native_session_snapshot',
      receipt: { sourceUrl, factCount: 1 },
    });
    store.close();
    stores.splice(stores.indexOf(store), 1);

    expect(readFileSync(databasePath).toString('utf8')).not.toContain(sourceUrl);
    const reopened = createStore(databasePath);
    expect(reopened.listNativeSourceConnections(candidate.id)[0]).toMatchObject({
      platform: 'hh',
      receipt: { sourceUrl, factCount: 1 },
    });
  });

  it('rolls evidence and resume back when receipt persistence fails', () => {
    const store = createStore();
    const candidate = createCandidate(store);

    expect(() =>
      store.commitResumeImport(
        candidate.id,
        commitInput({ sourceUrl: 'https://attacker.example/resume/731' }),
      ),
    ).toThrow('native hh source URL is invalid');
    expect(store.getSnapshot(candidate.id)).toMatchObject({
      memory: [],
      resume: null,
    });
    expect(store.listNativeSourceConnections(candidate.id)).toEqual([]);
  });

  it('disconnects one tenant across reopen without deleting imported memory or resume', () => {
    const directory = mkdtempSync(join(tmpdir(), 'openqareer-native-disconnect-'));
    directories.push(directory);
    const databasePath = join(directory, 'candidate.db');
    const store = createStore(databasePath);
    const candidate = createCandidate(store);
    const other = createCandidate(store);
    store.commitResumeImport(candidate.id, commitInput());
    store.commitResumeImport(
      other.id,
      commitInput({ memoryId: 'native-hh-result-2', importDigest: 'b'.repeat(64) }),
    );
    const imported = store.getSnapshot(candidate.id);

    expect(store.deleteNativeSourceConnection(candidate.id, 'hh')).toBe(true);
    expect(store.getSnapshot(candidate.id)).toMatchObject({
      memory: imported.memory,
      resume: imported.resume,
    });
    expect(store.listNativeSourceConnections(candidate.id)).toEqual([]);
    expect(store.listNativeSourceConnections(other.id)).toHaveLength(1);
    store.close();
    stores.splice(stores.indexOf(store), 1);

    const reopened = createStore(databasePath);
    expect(reopened.listNativeSourceConnections(candidate.id)).toEqual([]);
    expect(reopened.listNativeSourceConnections(other.id)).toHaveLength(1);
    expect(reopened.getSnapshot(candidate.id)).toMatchObject({
      memory: imported.memory,
      resume: imported.resume,
    });
  });

  it('exports safe native receipt metadata without the sealed or raw receipt payload', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    store.commitResumeImport(candidate.id, commitInput());

    const exported = store.exportCandidate(candidate.id);
    expect(exported.sourceConnections).toMatchObject([
      {
        platform: 'hh',
        accessMode: 'native_session_snapshot',
        capturedAt: '2026-08-23T12:00:00.000Z',
        factCount: 1,
      },
    ]);
    expect(JSON.stringify(exported.sourceConnections)).not.toContain(sourceUrl);
    expect(exported.sourceConnections[0]).not.toHaveProperty('receipt');
    expect(exported.sourceConnections[0]).not.toHaveProperty('importDigest');
    expect(exported.sourceConnections[0]).not.toHaveProperty('receiptCipher');
  });

  it('replaces unreviewed facts from the previous snapshot when profile data changes', () => {
    const store = createStore();
    const candidate = createCandidate(store);
    store.commitResumeImport(candidate.id, commitInput());

    store.commitResumeImport(
      candidate.id,
      commitInput({
        memoryId: 'native-hh-result-reimported',
        importDigest: 'd'.repeat(64),
      }),
    );

    expect(store.getSnapshot(candidate.id).memory).toMatchObject([
      { id: 'native-hh-result-reimported', status: 'proposed' },
    ]);
  });
});
