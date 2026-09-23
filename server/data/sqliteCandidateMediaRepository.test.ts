import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { SqliteCandidateMediaRepository } from './sqliteCandidateMediaRepository';
import { SealedText } from './sealedText';
import { applyMigrations } from './store/applyMigrations';

const databases: DatabaseSync[] = [];

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

function createRepository(): { repository: SqliteCandidateMediaRepository; database: DatabaseSync } {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  databases.push(database);
  applyMigrations(database, (op) => op());
  database.exec(
    "INSERT INTO candidates (id, token_hash, data_class, locale, created_at, updated_at)" +
      " VALUES ('candidate-1', 'hash-1', 'synthetic', 'ru-RU', '2026-09-23T10:00:00.000Z'," +
      " '2026-09-23T10:00:00.000Z')",
  );
  const sealedText = new SealedText(Buffer.alloc(32, 7));
  return { repository: new SqliteCandidateMediaRepository(database, sealedText), database };
}

describe('SqliteCandidateMediaRepository', () => {
  it('round-trips sealed bytes for a saved photo', () => {
    const { repository } = createRepository();
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]);

    repository.saveMany('candidate-1', [{ mediaId: 'media-1', kind: 'photo', mime: 'image/jpeg', bytes }]);

    const stored = repository.get('candidate-1', 'media-1');
    expect(stored?.mime).toBe('image/jpeg');
    expect(stored?.bytes).toEqual(bytes);
  });

  it('returns null for an unknown mediaId', () => {
    const { repository } = createRepository();
    expect(repository.get('candidate-1', 'nope')).toBeNull();
  });

  it("never opens another candidate's media, even with the same mediaId", () => {
    const { repository, database } = createRepository();
    database.exec(
      "INSERT INTO candidates (id, token_hash, data_class, locale, created_at, updated_at)" +
        " VALUES ('candidate-2', 'hash-2', 'synthetic', 'ru-RU', '2026-09-23T10:00:00.000Z'," +
        " '2026-09-23T10:00:00.000Z')",
    );
    repository.saveMany('candidate-2', [
      { mediaId: 'shared-id', kind: 'photo', mime: 'image/jpeg', bytes: Buffer.from([1, 2, 3]) },
    ]);
    expect(repository.get('candidate-1', 'shared-id')).toBeNull();
    expect(repository.get('candidate-2', 'shared-id')?.bytes).toEqual(Buffer.from([1, 2, 3]));
  });

  it('deletes rows the current draft no longer references', () => {
    const { repository } = createRepository();
    repository.saveMany('candidate-1', [
      { mediaId: 'keep', kind: 'photo', mime: 'image/jpeg', bytes: Buffer.from([1]) },
      { mediaId: 'drop', kind: 'employer_logo', mime: 'image/jpeg', bytes: Buffer.from([2]) },
    ]);

    repository.pruneUnreferenced('candidate-1', ['keep']);

    expect(repository.get('candidate-1', 'keep')).not.toBeNull();
    expect(repository.get('candidate-1', 'drop')).toBeNull();
  });

  it('deletes every row when nothing is referenced any more', () => {
    const { repository } = createRepository();
    repository.saveMany('candidate-1', [
      { mediaId: 'a', kind: 'photo', mime: 'image/jpeg', bytes: Buffer.from([1]) },
    ]);

    repository.pruneUnreferenced('candidate-1', []);

    expect(repository.get('candidate-1', 'a')).toBeNull();
  });

  it('re-saving the same mediaId overwrites rather than duplicating the row', () => {
    const { repository, database } = createRepository();
    repository.saveMany('candidate-1', [
      { mediaId: 'a', kind: 'photo', mime: 'image/jpeg', bytes: Buffer.from([1]) },
    ]);
    repository.saveMany('candidate-1', [
      { mediaId: 'a', kind: 'photo', mime: 'image/jpeg', bytes: Buffer.from([9, 9]) },
    ]);

    const count = database
      .prepare('SELECT COUNT(*) AS total FROM candidate_media WHERE candidate_id = ?')
      .get('candidate-1') as { total: number };
    expect(count.total).toBe(1);
    expect(repository.get('candidate-1', 'a')?.bytes).toEqual(Buffer.from([9, 9]));
  });

  it('cascades on candidate deletion', () => {
    const { repository, database } = createRepository();
    repository.saveMany('candidate-1', [
      { mediaId: 'a', kind: 'photo', mime: 'image/jpeg', bytes: Buffer.from([1]) },
    ]);

    database.prepare('DELETE FROM candidates WHERE id = ?').run('candidate-1');

    expect(repository.get('candidate-1', 'a')).toBeNull();
  });
});
