import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../appTestHarness';
import { backfillApplicationDescriptions } from './applicationDescriptionBackfill';
import { SealedText } from './sealedText';
import { SqliteCandidateStore } from './sqliteCandidateStore';

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'oq-b635-'));
  const databasePath = join(directory, 'test.sqlite');
  const store = new SqliteCandidateStore({ databasePath, encryptionKey: config.dataEncryptionKey });
  const database = new DatabaseSync(databasePath);
  cleanups.push(
    () => rmSync(directory, { recursive: true, force: true }),
    () => store.close(),
    () => database.close(),
  );
  const candidateId = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' }).id;
  const add = (clusterId: string | null, description?: string) =>
    store.createApplication(candidateId, {
      clusterId,
      stage: 'applied',
      manualVacancy: {
        title: 'CTO',
        company: 'Acme',
        url: `https://example.test/${randomUUID()}`,
        source: 'other',
        ...(description ? { description } : {}),
      },
    });
  const run = () =>
    backfillApplicationDescriptions({
      database,
      sealedText: new SealedText(config.dataEncryptionKey),
      enrich: (clusterId, snapshot) =>
        clusterId === 'cluster-live' ? { ...snapshot, description: 'Текст из пула' } : snapshot,
      pause: () => Promise.resolve(),
    });
  const read = (id: string) => store.getApplication(candidateId, id);
  return { add, run, read, database };
}

describe('B635: догон описания вакансии у старых откликов', () => {
  it('заполняет только вакансии из пула и не меняет версию и время отклика', async () => {
    const { add, run, read } = setup();
    const live = add('cluster-live');
    const gone = add('cluster-gone');
    const kept = add('cluster-kept', 'Свой текст');
    const manual = add(null);

    expect(await run()).toEqual({ checked: 3, filled: 1, failed: 0 });

    expect(read(live.id)).toMatchObject({
      version: live.version,
      updatedAt: live.updatedAt,
      vacancy: { title: 'CTO', company: 'Acme', description: 'Текст из пула' },
    });
    expect(read(gone.id)?.vacancy?.description).toBeUndefined();
    expect(read(kept.id)?.vacancy?.description).toBe('Свой текст');
    expect(read(manual.id)?.vacancy?.description).toBeUndefined();
    expect(await run()).toMatchObject({ filled: 0 });
  });

  it('повреждённый снимок не останавливает остальные', async () => {
    const { add, run, read, database } = setup();
    const broken = add('cluster-broken');
    const live = add('cluster-live');
    database.prepare("UPDATE applications SET vacancy_cipher = 'x' WHERE id = ?").run(broken.id);

    expect(await run()).toEqual({ checked: 2, filled: 1, failed: 1 });
    expect(read(live.id)?.vacancy?.description).toBe('Текст из пула');
  });
});
