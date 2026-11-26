import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteOwnVacancyStore } from './sqliteOwnVacancyStore';

const vacancy = { title: 'СЕКРЕТНАЯ-РОЛЬ', company: 'Ромашка', location: null, workFormat: null, url: 'https://jobs.example.com/1', text: 'ТЕКСТ-ВАКАНСИИ' };

describe('SqliteOwnVacancyStore', () => {
  const cleanup: Array<() => void> = [];
  afterEach(() => { for (const close of cleanup.splice(0)) close(); });
  function setup() {
    const directory = mkdtempSync(join(tmpdir(), 'oq-own-store-'));
    const path = join(directory, 'db.sqlite');
    const db = new DatabaseSync(path);
    cleanup.push(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
    return { db, path, store: new SqliteOwnVacancyStore(db, Buffer.alloc(32, 3)) };
  }

  it('видна только своему кандидату, содержимое запечатано', () => {
    const { db, path, store } = setup();
    const created = store.create('cand-a', vacancy);
    expect(store.get('cand-a', created.id)).toMatchObject(vacancy);
    expect(store.get('cand-b', created.id)).toBeUndefined();
    expect(store.list('cand-b')).toEqual([]);
    expect(store.delete('cand-b', created.id)).toBe(false);
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    const raw = readFileSync(path).toString('utf8');
    for (const secret of ['СЕКРЕТНАЯ-РОЛЬ', 'ТЕКСТ-ВАКАНСИИ', 'jobs.example.com', 'cand-a']) expect(raw).not.toContain(secret);
  });

  it('удаление аккаунта убирает все свои вакансии кандидата и только их', () => {
    const { store } = setup();
    store.create('cand-a', vacancy);
    store.create('cand-a', vacancy);
    store.create('cand-b', vacancy);
    expect(store.deleteCandidate('cand-a')).toBe(2);
    expect(store.count('cand-a')).toBe(0);
    expect(store.count('cand-b')).toBe(1);
  });
});
