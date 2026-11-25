import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { SealedText } from './sealedText';
import { SentPostingIndex } from './sentPostingIndex';

const URL = 'https://boards.example/jobs/1';

function setup() {
  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  database.exec(`CREATE TABLE candidates (id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE applications (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, cluster_id TEXT, stage TEXT NOT NULL) STRICT;
    INSERT INTO candidates VALUES ('alice'), ('bob');`);
  const snapshots = new Map<string, { title: string; url: string }>();
  const read = vi.fn((_candidateId: string, id: string) => {
    const snapshot = snapshots.get(id);
    return snapshot ? { ...snapshot, company: 'Acme', source: 'hh' } : null;
  });
  const index = new SentPostingIndex(database, new SealedText(randomBytes(32)), read);
  const add = (id: string, cluster: string, stage: string, title = 'CTO', url = URL) => {
    snapshots.set(id, { title, url });
    database.prepare("INSERT INTO applications VALUES (?, 'alice', ?, ?)").run(id, cluster, stage);
  };
  return { database, index, add, read };
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
