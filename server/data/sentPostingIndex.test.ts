import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { SealedText } from './sealedText';
import { SentPostingIndex } from './sentPostingIndex';

const URL = 'https://boards.example/jobs/1';

function setup() {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec(`CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE applications (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, cluster_id TEXT, stage TEXT NOT NULL, vacancy_cipher TEXT) STRICT;
    INSERT INTO candidates VALUES ('alice'), ('bob');`);
  const snapshots = new Map<string, { title: string; url: string }>();
  const read = vi.fn((_candidateId: string, id: string) => {
    const snapshot = snapshots.get(id);
    return snapshot ? { ...snapshot, company: 'Acme', source: 'hh' } : null;
  });
  const index = new SentPostingIndex(database, new SealedText(randomBytes(32)), read);
  const add = (id: string, cluster: string, stage: string, title = 'CTO', url = URL) => {
    snapshots.set(id, { title, url });
    database.prepare("INSERT INTO applications VALUES (?, 'alice', ?, ?, 'sealed')").run(id, cluster, stage);
  };
  return { database, index, add, read, snapshots };
}

const lookup = { clusterId: 'cluster-x', title: 'CTO', urls: [`${URL}/#apply`] };

describe('отправленный отклик на ту же вакансию (B801)', () => {
  it('находит по записи строки рядом с черновиком-дублем', () => {
    const { index, add } = setup();
    add('draft', 'cluster-x', 'saved');
    add('sent', 'x', 'applied');
    expect(index.find('alice', lookup)).toBe('sent');
  });

  it('находит по объявлению, каждый отклик расшифровывается один раз', () => {
    const { database, index, add, read } = setup();
    add('draft', 'cluster-x', 'saved');
    add('sent', 'other', 'interview');
    add('foreign', 'other-2', 'applied', 'CFO');
    expect(index.find('alice', lookup)).toBe('sent');
    expect(index.find('alice', lookup)).toBe('sent');
    expect(read).toHaveBeenCalledTimes(2);
    expect(index.find('bob', lookup)).toBeNull();
    const rows = database.prepare('SELECT posting_token FROM application_sent_postings').all();
    expect(JSON.stringify(rows)).not.toContain('boards.example');
    const plan = database
      .prepare(
        "EXPLAIN QUERY PLAN SELECT application_id FROM application_sent_postings WHERE candidate_id = 'a' AND posting_token IN ('b')",
      )
      .all();
    expect(JSON.stringify(plan)).toContain('application_sent_postings_token');
  });

  it('снимок вакансии появился позже — отклик находится', () => {
    const { database, index, add, snapshots } = setup();
    add('sent', 'other', 'applied');
    snapshots.delete('sent');
    database.exec("UPDATE applications SET vacancy_cipher = NULL WHERE id = 'sent'");
    expect(index.find('alice', lookup)).toBeNull();
    snapshots.set('sent', { title: 'CTO', url: URL });
    database.exec("UPDATE applications SET vacancy_cipher = 'sealed' WHERE id = 'sent'");
    expect(index.find('alice', lookup)).toBe('sent');
  });

  it('сбой посреди индексации не оставляет части строк; внутри чужой транзакции работает', () => {
    const { database, index, add } = setup();
    add('a', 'other', 'applied');
    add('b', 'other-2', 'applied', 'CFO');
    database.exec(`CREATE TRIGGER fail_b BEFORE INSERT ON application_sent_postings
      WHEN NEW.application_id = 'b' BEGIN SELECT RAISE(ABORT, 'busy'); END;`);
    expect(() => index.find('alice', lookup)).toThrow('busy');
    expect(database.prepare('SELECT * FROM application_sent_postings').all()).toHaveLength(0);
    database.exec('DROP TRIGGER fail_b; BEGIN');
    expect(index.find('alice', lookup)).toBe('a');
    database.exec('COMMIT');
    expect(database.prepare('SELECT * FROM application_sent_postings').all()).toHaveLength(2);
  });

  it('архив, другое название, другой адрес — не отправлен; сменилась стадия — найден', () => {
    const { database, index, add } = setup();
    add('a', 'y', 'archived');
    add('b', 'z', 'applied', 'CFO');
    add('c', 'w', 'applied', 'CTO', 'https://boards.example/jobs/2');
    add('d', 'v', 'saved');
    expect(index.find('alice', lookup)).toBeNull();
    database.exec("UPDATE applications SET stage = 'applied' WHERE id = 'd'");
    expect(index.find('alice', lookup)).toBe('d');
  });
});
