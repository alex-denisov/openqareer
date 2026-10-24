import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SEO_GOAL_MIGRATION } from './seoGoalSchema';
import { readSeoGoalSummary, recordCandidateGoal } from './seoGoalRepository';
import { createStore, directories } from './sqliteTestHarness';
import { SealedText } from './sealedText';
import { SqliteApplicationRepository } from './sqliteApplicationRepository';
import { MIGRATION_33, MIGRATION_38 } from './sqliteSchema';

const now = new Date('2026-10-24T10:00:00.000Z');
const at = '2026-10-24T09:00:00.000Z';
const workspace = { resumeText: '', resumeSource: 'text' as const, targetDirection: 'Analyst', regions: [],
  currentSituation: '', constraints: '', urgency: 'active' as const };

function database() {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true });
  db.exec(`CREATE TABLE candidates (id TEXT PRIMARY KEY, data_class TEXT);
    INSERT INTO candidates VALUES ('personal', 'personal'), ('test', 'synthetic');`);
  db.exec(SEO_GOAL_MIGRATION);
  return db;
}

describe('internal candidate goals', () => {
  it('records explicit completion once; ordinary PUT/storage does not count', () => {
    const store = createStore();
    const c = store.createCandidate({ dataClass: 'personal', locale: 'ru-RU' });
    store.saveCandidateWorkspace(c.id, workspace);
    expect(store.getSeoGoalSummary().goals.onboardingCompleted).toBe(0);
    store.completeCandidateWorkspace(c.id, workspace);
    store.completeCandidateWorkspace(c.id, { ...workspace, constraints: 'updated' });
    expect(store.getCandidateWorkspace(c.id)?.constraints).toBe('updated');
    expect(store.getSeoGoalSummary().goals.onboardingCompleted).toBe(1);
    const test = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
    store.completeCandidateWorkspace(test.id, workspace);
    expect(store.getSeoGoalSummary().goals.onboardingCompleted).toBe(1);
    store.deleteCandidate(c.id);
    expect(store.getSeoGoalSummary().goals.onboardingCompleted).toBe(0);
  });

  it('rolls back workspace changes when completion marker insertion fails', () => {
    const directory = mkdtempSync(join(tmpdir(), 'oq-goal-rollback-'));
    directories.push(directory);
    const path = join(directory, 'app.sqlite');
    const store = createStore(path);
    const c = store.createCandidate({ dataClass: 'personal', locale: 'ru-RU' });
    store.saveCandidateWorkspace(c.id, workspace);
    const db = new DatabaseSync(path);
    try {
      db.exec(`CREATE TRIGGER reject_goal BEFORE INSERT ON candidate_goal_markers BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
      expect(() => store.completeCandidateWorkspace(c.id, { ...workspace, constraints: 'must roll back' })).toThrow('synthetic failure');
      expect(store.getCandidateWorkspace(c.id)?.constraints).toBe('');
      expect(store.getSeoGoalSummary().goals.onboardingCompleted).toBe(0);
    } finally { db.close(); }
  });

  it('excludes synthetic, out-of-window and deleted data and never exposes candidate fields', () => {
    const db = database();
    try {
      recordCandidateGoal(db, 'personal', 'onboarding_completed', 'wizard', 'wizard_completion', at);
      recordCandidateGoal(db, 'personal', 'onboarding_completed', 'wizard', 'wizard_completion', at);
      recordCandidateGoal(db, 'test', 'onboarding_completed', 'wizard', 'wizard_completion', at);
      recordCandidateGoal(db, 'personal', 'application_receipt', 'old', 'screenshot', '2025-01-01T00:00:00Z');
      const result = readSeoGoalSummary(db, 28, now);
      expect(result.goals).toEqual({ onboardingCompleted: 1, proTrialsStarted: null, applicationsWithCandidateReceipt: 0 });
      expect(JSON.stringify(result)).not.toContain('candidate_id');
      expect(JSON.stringify(result)).not.toContain('resume');
      expect(result.methodology.organicConversion).toBe('unavailable_no_attribution');
      db.exec("DELETE FROM candidates WHERE id = 'personal'");
      expect(readSeoGoalSummary(db, 28, now).goals.onboardingCompleted).toBe(0);
    } finally { db.close(); }
  });

  it('also excludes a personal candidate explicitly designated as an auth test account', () => {
    const db = database();
    try {
      db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, candidate_id TEXT, is_test INTEGER);
        INSERT INTO users VALUES ('test-user', 'personal', 1);`);
      recordCandidateGoal(db, 'personal', 'onboarding_completed', 'wizard', 'wizard_completion', at);
      recordCandidateGoal(db, 'personal', 'application_receipt', 'receipt', 'auto_reply', at);
      expect(readSeoGoalSummary(db, 28, now).goals).toEqual({
        onboardingCompleted: 0, proTrialsStarted: null, applicationsWithCandidateReceipt: 0,
      });
    } finally { db.close(); }
  });

  it('counts committed trial rows only, excluding synthetic and auth test accounts', () => {
    const db = database();
    try {
      db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, candidate_id TEXT, is_test INTEGER);
        CREATE TABLE billing_pro_trials(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, started_at TEXT);
        INSERT INTO users VALUES ('real', 'personal', 0), ('test-user', 'personal', 1), ('synthetic', 'test', 0);`);
      const insert = db.prepare('INSERT INTO billing_pro_trials VALUES (?, ?)');
      insert.run('real', at); insert.run('test-user', at); insert.run('synthetic', at);
      expect(readSeoGoalSummary(db, 28, now).goals.proTrialsStarted).toBe(1);
      db.exec("DELETE FROM users WHERE id='real'");
      expect(readSeoGoalSummary(db, 28, now).goals.proTrialsStarted).toBe(0);
    } finally { db.close(); }
  });

  it('counts positive candidate receipts once, never stage attempts/failure notes, atomically with receipt', () => {
    const db = database();
    try {
      db.exec(MIGRATION_33); db.exec(MIGRATION_38);
      const repo = new SqliteApplicationRepository(db, new SealedText(Buffer.alloc(32, 9)));
      const app = repo.create('personal', { stage: 'saved' });
      const attempted = repo.patch('personal', app.id, { stage: 'applied', expectedVersion: app.version });
      expect(db.prepare('SELECT * FROM candidate_goal_markers').all()).toHaveLength(0);
      const failed = repo.patch('personal', app.id, { expectedVersion: attempted.version, deliveryReceipt: { kind: 'failure_note', value: 'failed' } });
      expect(db.prepare('SELECT * FROM candidate_goal_markers').all()).toHaveLength(0);
      const delivered = repo.patch('personal', app.id, { expectedVersion: failed.version, deliveryReceipt: { kind: 'confirmation_url', value: 'https://example.test/receipt/private' } });
      repo.patch('personal', app.id, { expectedVersion: delivered.version, deliveryReceipt: { kind: 'screenshot', value: 'private.png' } });
      const rows = db.prepare('SELECT * FROM candidate_goal_markers').all();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ provenance: 'candidate', evidence_kind: 'confirmation_url', entity_key: app.id });
      expect(JSON.stringify(rows)).not.toContain('https://');
      const second = repo.create('personal', { stage: 'applied' });
      db.exec(`CREATE TRIGGER reject_goal BEFORE INSERT ON candidate_goal_markers BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
      expect(() => repo.patch('personal', second.id, { expectedVersion: second.version, deliveryReceipt: { kind: 'auto_reply', value: 'private' } })).toThrow('synthetic failure');
      expect(repo.get('personal', second.id)?.version).toBe(second.version);
      expect(repo.listEvents('personal', second.id)).toHaveLength(1);
    } finally { db.close(); }
  });
});
