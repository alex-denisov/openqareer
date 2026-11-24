import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE } from '../candidate/candidateAutomationScheduler';
import { forbiddenExportKeys } from './exportForbiddenKeys';
import { seedAutoApply, seedHh } from './exportTestSeeds';
import { createCandidate, createStore, directories } from './sqliteTestHarness';

const AT = '2026-11-23T10:00:00.000Z';

function fileStore() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-automation-export-'));
  directories.push(directory);
  const databasePath = join(directory, 'candidate.sqlite');
  return { databasePath, store: createStore(databasePath) };
}

describe('B738 · 8: автоотклики и hh.ru в выгрузке', () => {
  it('настройки, очередь, журнал, попытки, подъём и снимок резюме — без кодов ошибок и квитанций, без чужого', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const other = createCandidate(store);
    const database = new DatabaseSync(databasePath);
    seedAutoApply(database, own.id, 'own');
    seedAutoApply(database, other.id, 'other');
    seedHh(databasePath, database, own.id, 'own');
    seedHh(databasePath, database, other.id, 'other');
    database.close();

    const automation = store.exportCandidate(own.id).automation;
    expect(automation.settings).toMatchObject({ enabled: true, mode: 'approval_required' });
    expect(automation.consents).toEqual([expect.objectContaining({ key: 'drafts', text: 'Согласие own' })]);
    expect(automation.stopCompanies).toEqual([expect.objectContaining({ company: 'Стоп own' })]);
    expect(automation.queue).toEqual([expect.objectContaining({ payload: expect.objectContaining({ letterText: 'Письмо own' }) })]);
    expect(automation.schedule).toEqual(DEFAULT_CANDIDATE_AUTOMATION_SCHEDULE);
    expect(automation.journal).toEqual([expect.objectContaining({ result: 'error', company: 'Компания own' })]);
    expect(automation.hh.applyAttempts).toEqual([{ vacancyId: 'vacancy-own', resumeId: 'resume-own', outcome: 'applied', startedAt: AT, finishedAt: AT }]);
    expect(automation.hh.applyConsents).toEqual([
      { host: 'hh.ru', consentText: 'Согласие own', policyUrl: null, basis: 'actions_on_behalf-v1.1', givenAt: AT },
    ]);
    expect(automation.hh.raiseChoice).toEqual([expect.objectContaining({ resumeId: 'resume-own' })]);
    expect(automation.hh.raiseSchedules).toEqual([expect.objectContaining({ resumeId: 'resume-own', enabled: 1 })]);
    expect(automation.hh.resumeSnapshot).toEqual({ resumes: [{ id: 'resume-own', title: 'Резюме own' }], selected: null, readAt: AT });
    const text = JSON.stringify(automation);
    for (const leak of ['internal_code', 'receipt-own', 'other']) expect(text).not.toContain(leak);
    expect(forbiddenExportKeys(automation)).toEqual([]);
  });

  it('повреждённая строка очереди и снимок резюме не роняют выгрузку', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const database = new DatabaseSync(databasePath);
    seedAutoApply(database, own.id, 'own');
    seedAutoApply(database, own.id, 'second');
    seedHh(databasePath, database, own.id, 'own');
    database.prepare("UPDATE candidate_auto_apply_queue SET payload_cipher = 'broken' WHERE rowid = (SELECT min(rowid) FROM candidate_auto_apply_queue)").run();
    database.prepare("UPDATE hh_resume_snapshots SET snapshot_cipher = 'broken'").run();
    database.close();

    const automation = store.exportCandidate(own.id).automation;
    expect(automation.queue).toHaveLength(1);
    expect(automation.hh.resumeSnapshot).toBeNull();
    expect(automation.journal).toHaveLength(2);
  });

  it('без таблиц раздел пустой и схема не меняется', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const tables = () => new DatabaseSync(databasePath).prepare("SELECT group_concat(name) AS names FROM (SELECT name FROM sqlite_master WHERE type='table' ORDER BY name)").get();
    const before = tables();
    expect(store.exportCandidate(own.id).automation).toMatchObject({ settings: null, queue: [], journal: [], hh: { applyAttempts: [], applyConsents: [], resumeSnapshot: null } });
    expect(tables()).toEqual(before);
  });
});
