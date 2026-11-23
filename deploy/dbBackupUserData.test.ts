import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { copyUserData, isRecollectable, parsePatterns } from './dbBackupUserData.mjs';

const PATTERNS = parsePatterns('# кэши\nvacancy_pool\ncatalog_*\n\n');

function source(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT);
    CREATE TABLE candidate_drafts (id INTEGER PRIMARY KEY, candidate_id INTEGER, body TEXT);
    CREATE INDEX candidate_drafts_by_candidate ON candidate_drafts(candidate_id);
    CREATE TRIGGER candidate_drafts_require_candidate BEFORE INSERT ON candidate_drafts
      WHEN NOT EXISTS (SELECT 1 FROM candidates WHERE id = NEW.candidate_id)
      BEGIN SELECT RAISE(ABORT, 'no candidate'); END;
    CREATE TABLE vacancy_pool (id TEXT PRIMARY KEY, raw TEXT);
    CREATE TABLE catalog_entries (id TEXT PRIMARY KEY);
    CREATE TABLE applications (id INTEGER PRIMARY KEY, vacancy_id TEXT REFERENCES vacancy_pool(id));
    CREATE VIRTUAL TABLE consultant_messages_fts USING fts5(candidate_id UNINDEXED, body);
    INSERT INTO candidates (name) VALUES ('Анна'), ('Борис');
    DELETE FROM candidates WHERE name = 'Борис';
    INSERT INTO candidate_drafts VALUES (1, 1, 'письмо');
    INSERT INTO vacancy_pool VALUES ('v1', 'большой текст');
    INSERT INTO catalog_entries VALUES ('c1');
    INSERT INTO applications VALUES (1, 'v1');
    INSERT INTO consultant_messages_fts VALUES ('1', 'разговор о карьере');
  `);
  db.close();
}

describe('B777: копия пользовательских таблиц', () => {
  it('шаблоны: точное имя и префикс со звёздочкой; комментарии и пустые строки пропускаются', () => {
    expect(PATTERNS).toEqual(['vacancy_pool', 'catalog_*']);
    expect(isRecollectable('vacancy_pool', PATTERNS)).toBe(true);
    expect(isRecollectable('vacancy_pool_index', PATTERNS)).toBe(false);
    expect(isRecollectable('catalog_listing_history', PATTERNS)).toBe(true);
    expect(isRecollectable('candidates', PATTERNS)).toBe(false);
  });

  it('схема целиком, данные только незаменимых таблиц; индексы, триггеры, AUTOINCREMENT и поиск работают', () => {
    const dir = mkdtempSync(join(tmpdir(), 'b777-'));
    source(join(dir, 'source.db'));
    const report = copyUserData(join(dir, 'source.db'), join(dir, 'users.db'), PATTERNS);
    expect(report.skipped).toEqual(['catalog_entries', 'vacancy_pool']);
    // Отклик ссылается на вакансию из пула, которого в копии нет: внешние ключи не мешают переносу.
    expect(report.rows).toMatchObject({ candidates: 1, candidate_drafts: 1, applications: 1 });

    const copy = new DatabaseSync(join(dir, 'users.db'));
    expect(copy.prepare('SELECT COUNT(*) AS n FROM vacancy_pool').get()).toEqual({ n: 0 });
    expect(copy.prepare('SELECT body FROM candidate_drafts').get()).toEqual({ body: 'письмо' });
    expect(
      copy.prepare("SELECT name FROM sqlite_schema WHERE type = 'index'").all(),
    ).toContainEqual({
      name: 'candidate_drafts_by_candidate',
    });
    expect(() => copy.exec("INSERT INTO candidate_drafts VALUES (2, 99, 'x')")).toThrow(
      /no candidate/u,
    );
    copy.exec("INSERT INTO candidates (name) VALUES ('Вера')");
    expect(copy.prepare("SELECT id FROM candidates WHERE name = 'Вера'").get()).toEqual({ id: 3 });
    expect(
      copy
        .prepare(
          "SELECT body FROM consultant_messages_fts WHERE consultant_messages_fts MATCH 'карьере'",
        )
        .all(),
    ).toEqual([{ body: 'разговор о карьере' }]);
    expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    copy.close();
  });
});
