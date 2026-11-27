import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SqliteCandidateActionRepository } from '../candidate/sqliteCandidateActionRepository';
import { SqliteQuestionnaireRepository } from '../candidate/sqliteQuestionnaireRepository';
import { SqliteRejectionReviewRepository } from '../candidate/sqliteRejectionReviewRepository';
import type { ApplicationTrackerMethods } from './sqliteCandidateStoreApplicationMethods';
import { createCandidate, createStore, directories } from './sqliteTestHarness';

const KEY = Buffer.alloc(32, 4);

function fileStore() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-tracker-export-'));
  directories.push(directory);
  const databasePath = join(directory, 'candidate.sqlite');
  return { databasePath, store: createStore(databasePath) };
}

/** Трекер кандидата так, как его пишут маршруты: хранилище и отдельные репозитории. */
function seedTracker(store: ReturnType<typeof createStore>, databasePath: string, candidateId: string, tag: string) {
  const application = store.createApplication(candidateId, {
    manualVacancy: { title: `CTO ${tag}`, company: `Компания ${tag}`, source: 'other', url: `https://example.test/${tag}` },
    stage: 'applied',
  });
  store.setApplicationContact(candidateId, application.id, `Рекрутер ${tag}`);
  store.markEmployerRead(candidateId, application.id, { readAt: '2026-11-20T10:00:00.000Z', source: 'candidate' });
  const labels = store as unknown as ApplicationTrackerMethods;
  const label = labels.createApplicationLabel(candidateId, `Метка ${tag}`);
  labels.assignApplicationLabel(candidateId, application.id, label.id);
  store.createApplicationInterview(candidateId, application.id, { round: 1, format: `Формат ${tag}` });
  store.putApplicationOffer(candidateId, application.id, { baseSalary: 500_000, currency: 'RUB', location: `Город ${tag}` }, null);
  store.starPrepRepo.put(
    candidateId,
    application.id,
    [{ questionId: 'q1', field: 'result', text: `STAR ${tag}`, sourceFactId: 'fact-1' }],
    '2026-11-20T10:00:00.000Z',
  );
  store.createVacancySkip(candidateId, { clusterId: `cluster-${tag}`, reasonId: 'level', origin: 'vacancy_card' });

  const questionnaires = new SqliteQuestionnaireRepository({ databasePath, encryptionKey: KEY });
  questionnaires.saveQuestions(candidateId, `vacancy-${tag}`, {
    questions: [{ id: 'q1', text: 'Почему мы?', required: true, kind: 'text' } as never],
    formUrl: null,
    readAt: '2026-11-20T10:00:00.000Z',
  });
  questionnaires.saveAnswers(candidateId, `vacancy-${tag}`, [{ questionId: 'q1', text: `Ответ ${tag}` }]);
  questionnaires.close();
  const rejections = new SqliteRejectionReviewRepository({ databasePath, encryptionKey: KEY });
  rejections.saveReason({
    candidateId,
    applicationId: application.id,
    reason: 'money',
    note: `Причина ${tag}`,
    recordedAt: '2026-11-21T10:00:00.000Z',
  });
  rejections.saveHelped(candidateId, true, '2026-11-21T10:00:00.000Z');
  rejections.close();
  const actions = new SqliteCandidateActionRepository({ databasePath });
  actions.createBatch(`batch-${tag}`, candidateId, '2026-11-20T09:00:00.000Z');
  actions.recordReceipt({
    batchId: `batch-${tag}`,
    candidateId,
    platform: 'hh',
    actionKind: 'hh_apply',
    status: 'delivered',
    applicationId: application.id,
  } as never);
  actions.close();
  return { applicationId: application.id, labelId: label.id };
}

describe('B738 · 1: выгрузка отдаёт трекер откликов', () => {
  it('в выгрузке весь трекер кандидата и ничего от чужого', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const other = createCandidate(store);
    const { applicationId, labelId } = seedTracker(store, databasePath, own.id, 'свой');
    seedTracker(store, databasePath, other.id, 'чужой');

    const exported = store.exportCandidate(own.id);
    const tracker = exported.tracker;

    expect(tracker.applications).toMatchObject([
      {
        id: applicationId,
        vacancy: { company: 'Компания свой' },
        interviews: [{ round: 1, format: 'Формат свой' }],
        offer: { terms: { location: 'Город свой' } },
      },
    ]);
    expect(tracker.applications[0]?.events.length).toBeGreaterThan(0);
    expect(tracker.contacts).toEqual([{ applicationId, name: 'Рекрутер свой' }]);
    expect(tracker.employerReads).toEqual([
      { applicationId, readAt: '2026-11-20T10:00:00.000Z', source: 'candidate' },
    ]);
    expect(tracker.labels).toMatchObject([{ id: labelId, name: 'Метка свой' }]);
    expect(tracker.labelAssignments).toMatchObject([{ applicationId, labelId }]);
    expect(tracker.starPreps).toMatchObject([{ applicationId, paragraphs: [{ text: 'STAR свой' }] }]);
    expect(tracker.vacancySkips).toMatchObject([{ clusterId: 'cluster-свой' }]);
    expect(tracker.questionnaires).toMatchObject([
      { vacancyId: 'vacancy-свой', answers: [{ questionId: 'q1', text: 'Ответ свой' }] },
    ]);
    expect(tracker.rejectionReasons).toEqual([
      { applicationId, reason: 'money', note: 'Причина свой', recordedAt: '2026-11-21T10:00:00.000Z' },
    ]);
    expect(tracker.rejectionReviewHelped).toBe(true);
    expect(tracker.actionBatches).toMatchObject([{ id: 'batch-свой', confirmedAt: '2026-11-20T09:00:00.000Z' }]);
    expect(tracker.actionReceipts).toMatchObject([{ batchId: 'batch-свой', applicationId, status: 'delivered' }]);
    expect(tracker.stagePromotions).toMatchObject([{ applicationId, fromStage: 'applied' }]);
    for (const key of ['retryRequests', 'referralTracks', 'vacancyApplications', 'careerCommands', 'commandApprovals', 'outreach'] as const) {
      expect(tracker[key]).toEqual([]);
    }
    expect(JSON.stringify(exported)).not.toContain('чужой');
  });

  it('без маршрутов анкет, разбора отказов и действий выгрузка их таблицы не создаёт', () => {
    const { databasePath, store } = fileStore();
    const candidate = createCandidate(store);
    const tracker = store.exportCandidate(candidate.id).tracker;
    expect([tracker.questionnaires, tracker.rejectionReasons, tracker.actionReceipts]).toEqual([[], [], []]);
    expect(tracker.rejectionReviewHelped).toBeNull();

    const database = new DatabaseSync(databasePath);
    const created = database
      .prepare(
        `SELECT name FROM sqlite_master WHERE name IN
         ('application_questionnaires', 'application_rejection_reasons', 'candidate_action_receipts')`,
      )
      .all();
    database.close();
    expect(created).toEqual([]);
  });
});
