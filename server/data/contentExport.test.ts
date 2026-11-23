import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteCandidateDraftRepository } from '../candidate/sqliteCandidateDraftRepository';
import { SqliteTextVariantRepository } from '../candidate/sqliteTextVariantRepository';
import { forbiddenExportKeys } from './exportForbiddenKeys';
import { FEED_POST_TABLES } from './feedPostSchema';
import { ensureCommentRhythmColumns, LINKEDIN_QUEUE_TABLES } from './linkedinQueueSchema';
import { LINKEDIN_SECTION_TABLES } from './linkedinSectionsSchema';
import { createCandidate, createStore, directories } from './sqliteTestHarness';

const AT = '2026-11-23T10:00:00.000Z';
const KEY = Buffer.alloc(32, 4);

function fileStore() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-content-export-'));
  directories.push(directory);
  const databasePath = join(directory, 'candidate.sqlite');
  return { databasePath, store: createStore(databasePath) };
}

/** Схема согласования черновиков, как её ставят маршруты черновиков. */
const WORKFLOW_TABLES = `
CREATE TABLE IF NOT EXISTS candidate_draft_workflow (
  draft_id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, approved_at TEXT NOT NULL,
  published_at TEXT, updated_at TEXT NOT NULL) STRICT;
CREATE TABLE IF NOT EXISTS candidate_draft_topic_decisions (
  candidate_id TEXT NOT NULL, topic_id TEXT NOT NULL, decision TEXT NOT NULL, decided_at TEXT NOT NULL,
  PRIMARY KEY (candidate_id, topic_id)) STRICT;`;

function seed(database: DatabaseSync, candidateId: string, tag: string) {
  const draft = new SqliteCandidateDraftRepository(database).create({
    candidateId, kind: 'post', topic: `Тема ${tag}`, text: `Пост ${tag}`, localDate: '2026-11-23',
  });
  database.exec(WORKFLOW_TABLES + FEED_POST_TABLES + LINKEDIN_SECTION_TABLES + LINKEDIN_QUEUE_TABLES);
  database.prepare('INSERT INTO candidate_draft_workflow VALUES (?,?,?,?,?)').run(draft.id, candidateId, AT, null, AT);
  database.prepare('INSERT INTO candidate_draft_topic_decisions VALUES (?,?,?,?)').run(candidateId, `topic-${tag}`, 'used', AT);
  database.prepare('INSERT INTO candidate_feed_posts VALUES (?,?,?,?,?)').run(draft.id, candidateId, null, `Выдержка ${tag}`, AT);
  database.prepare('INSERT INTO candidate_linkedin_sections VALUES (?,?,?,?,?)').run(candidateId, 'about', `О себе ${tag}`, 'paste', AT);
  database.prepare('INSERT INTO candidate_linkedin_section_events VALUES (?,?,?,?)').run(candidateId, 'about', AT, null);
  database.prepare('INSERT INTO candidate_linkedin_offer_variants VALUES (?,?,?,?,?)').run(candidateId, 'headline', 1, `Заголовок ${tag}`, AT);
  database.prepare('INSERT INTO candidate_linkedin_rhythm (candidate_id, posts_per_week, days, time, timezone, updated_at) VALUES (?,?,?,?,?,?)')
    .run(candidateId, 2, '["mon","thu"]', '09:00', 'Europe/Berlin', AT);
  ensureCommentRhythmColumns(database);
  database.prepare("UPDATE candidate_linkedin_rhythm SET comments_per_day = 3, comment_days = '[\"mon\"]', comment_from = '09:00', comment_to = '12:00' WHERE candidate_id = ?")
    .run(candidateId);
  database.prepare(`INSERT INTO candidate_linkedin_queue(id,candidate_id,draft_id,kind,scheduled_at,state,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(`queue-${tag}`, candidateId, draft.id, 'post', AT, 'queued', AT, AT);
  new SqliteTextVariantRepository(database, KEY).add({
    candidateId, kind: 'post', subjectId: draft.id, text: `Вариант ${tag}`, wish: { chips: ['shorter'], text: '' }, createdAt: AT,
  });
  return draft.id;
}

describe('B738 · 4: черновики, посты, варианты текстов и LinkedIn в выгрузке', () => {
  it('все десять таблиц кандидата, варианты открыты, чужого нет', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const other = createCandidate(store);
    const database = new DatabaseSync(databasePath);
    const draftId = seed(database, own.id, 'свой');
    seed(database, other.id, 'чужой');
    database.close();

    const content = store.exportCandidate(own.id).content;
    expect(content.drafts).toEqual([expect.objectContaining({ id: draftId, topic: 'Тема свой', text: 'Пост свой', status: 'draft' })]);
    expect(content.draftWorkflow).toEqual([{ draftId, approvedAt: AT, publishedAt: null, updatedAt: AT }]);
    expect(content.draftTopicDecisions).toEqual([{ topicId: 'topic-свой', decision: 'used', decidedAt: AT }]);
    expect(content.feedPosts).toEqual([{ draftId, postUrl: null, excerpt: 'Выдержка свой', createdAt: AT }]);
    expect(content.textVariants).toEqual([
      { kind: 'post', subjectId: draftId, variants: [expect.objectContaining({ position: 1, text: 'Вариант свой', wish: { chips: ['shorter'], text: '' } })] },
    ]);
    expect(content.linkedin.sections).toEqual([{ section: 'about', text: 'О себе свой', source: 'paste', capturedAt: AT }]);
    expect(content.linkedin.sectionEvents).toEqual([{ section: 'about', copiedAt: AT, pastedAt: null }]);
    expect(content.linkedin.offerVariants).toEqual([{ offerKey: 'headline', position: 1, text: 'Заголовок свой', createdAt: AT }]);
    expect(content.linkedin.rhythm).toEqual({
      postsPerWeek: 2, days: '["mon","thu"]', time: '09:00', timezone: 'Europe/Berlin', updatedAt: AT,
      commentsPerDay: 3, commentDays: '["mon"]', commentFrom: '09:00', commentTo: '12:00',
    });
    expect(content.linkedin.queue).toEqual([expect.objectContaining({ id: 'queue-свой', draftId, state: 'queued' })]);
    expect(JSON.stringify(content)).not.toContain('чужой');
    expect(forbiddenExportKeys(content)).toEqual([]);
  });

  it('без таблиц раздел пустой и схема не меняется', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const tables = () => new DatabaseSync(databasePath).prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get();
    const before = tables();
    expect(store.exportCandidate(own.id).content).toEqual({
      drafts: [], draftWorkflow: [], draftTopicDecisions: [], feedPosts: [], textVariants: [],
      linkedin: { sections: [], sectionEvents: [], offerVariants: [], rhythm: null, queue: [] },
    });
    expect(tables()).toEqual(before);
  });

  it('проверка секретов находит поле с запрещённым именем на любой глубине', () => {
    expect(forbiddenExportKeys({ a: [{ ok: 1, passwordHash: 'x' }], b: { sessionToken: 'y' } })).toEqual(['a[0].passwordHash', 'b.sessionToken']);
  });
});
