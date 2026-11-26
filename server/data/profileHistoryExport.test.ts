import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildTargetedResumeSlice } from '../domain/resumeStudio';
import type { ResumeDocument } from '../domain/resumeStudioTypes';
import { estimateResumePages } from '../domain/resumeTargetedVolume';
import { SealedText } from './sealedText';
import { SqliteCandidateMediaRepository } from './sqliteCandidateMediaRepository';
import { createCandidate, createStore, directories } from './sqliteTestHarness';

const AT = '2026-11-20T10:00:00.000Z';

const MASTER: ResumeDocument = {
  kind: 'master',
  targetRole: 'Platform Engineer',
  contact: { fullName: 'Синтетический Кандидат', email: 'synthetic@example.test', phone: null, location: 'Berlin', links: [] },
  about: null,
  experience: [],
  skills: [],
  education: [],
  projects: [],
  languages: [],
  unknowns: [],
  conventions: {
    country: null,
    packVersion: null,
    reverseChronological: true,
    maxPages: null,
    recommendedBulletsPerRole: null,
    photo: 'omitted',
    discriminatoryPii: 'omitted',
  },
  length: { lines: 0, pages: 1, linesPerPage: 45 },
};

function fileStore() {
  const directory = mkdtempSync(join(tmpdir(), 'openqareer-profile-export-'));
  directories.push(directory);
  const databasePath = join(directory, 'candidate.sqlite');
  return { databasePath, store: createStore(databasePath) };
}

/** История профиля так, как её пишут маршруты: методы хранилища и его репозиториев. */
function seedProfileHistory(store: ReturnType<typeof createStore>, databasePath: string, candidateId: string, tag: string) {
  store.createResumeVersion(candidateId, `version-${tag}`, 'master-1', {
    title: `Версия ${tag}`,
    requirements: ['Kubernetes'],
    status: 'draft',
    snapshot: estimateResumePages(buildTargetedResumeSlice(MASTER, { title: `Версия ${tag}`, requirements: ['Kubernetes'] })),
  });
  store.profileChangeLog.record({
    id: `change-${tag}`,
    candidateId,
    actor: 'candidate',
    section: 'about',
    itemId: null,
    label: `Поле ${tag}`,
    previous: `Было ${tag}`,
    applied: `Стало ${tag}`,
    commandId: null,
    createdAt: AT,
  });
  store.profileRevisionRepo.recordRevision({
    id: `revision-${tag}`,
    candidateId,
    commandId: `command-${tag}`,
    section: 'headline',
    previousText: `Заголовок был ${tag}`,
    appliedText: `Заголовок стал ${tag}`,
    createdAt: AT,
  });
  store.careerVectorRepo.put(candidateId, { answers: { goal: `Цель ${tag}` } as never, vector: null, rationale: [] as never }, AT);
  store.decisionProfileRepo.put(
    candidateId,
    { citizenship: [`Гражданство ${tag}`], languages: [], workFormats: [] } as never,
    AT,
  );
  store.skillQuizAttempts.create(candidateId, {
    id: `attempt-${tag}`,
    skillName: `Навык ${tag}`,
    skillKey: `skill-${tag}`,
    level: 'middle',
    questions: [],
    createdAt: AT,
    submittedAt: null,
    result: null,
    appliedCommandId: null,
  } as never);
  store.interviewSimulatorRepo.designSchemas.set(
    { candidateId, sessionId: `session-${tag}`, questionId: 'q1' },
    { nodes: [`Схема ${tag}`] } as never,
    AT,
  );
  store.interviewSimulatorRepo.reviewHelpful.set({ candidateId, sessionId: `session-${tag}`, questionId: 'q1' }, true, AT);
  const database = new DatabaseSync(databasePath);
  new SqliteCandidateMediaRepository(database, new SealedText(Buffer.alloc(32, 4))).saveMany(candidateId, [
    { mediaId: `photo-${tag}`, kind: 'photo', mime: 'image/png', bytes: Buffer.from(`фото ${tag}`) },
  ]);
  database
    .prepare(
      `INSERT INTO candidate_goal_markers (candidate_id, kind, entity_key, recorded_at, evidence_kind, provenance)
       VALUES (?, 'application_receipt', ?, ?, 'confirmation_url', 'candidate')`,
    )
    .run(candidateId, `receipt-${tag}`, AT);
  database
    .prepare(
      `INSERT INTO candidate_import_walks (candidate_id, platform, state, sections_json, updated_at)
       VALUES (?, 'hh', 'done', ?, ?)`,
    )
    .run(candidateId, JSON.stringify([`Раздел ${tag}`]), AT);
  database
    .prepare('INSERT INTO consultant_rejections (candidate_id, proposal_key, reason, created_at) VALUES (?, ?, ?, ?)')
    .run(candidateId, `proposal-${tag}`, `Не подходит ${tag}`, AT);
  database.close();
}

describe('B738 · 3: выгрузка отдаёт историю профиля', () => {
  it('версии резюме, правки, ответы и попытки кандидата, без чужих', () => {
    const { databasePath, store } = fileStore();
    const own = createCandidate(store);
    const other = createCandidate(store);
    seedProfileHistory(store, databasePath, own.id, 'свой');
    seedProfileHistory(store, databasePath, other.id, 'чужой');

    const exported = store.exportCandidate(own.id).profileHistory;

    expect(exported.resumeVersions).toMatchObject([{ id: 'version-свой', title: 'Версия свой' }]);
    expect(exported.media).toEqual([
      { mediaId: 'photo-свой', kind: 'photo', mime: 'image/png', createdAt: expect.any(String), base64: Buffer.from('фото свой').toString('base64') },
    ]);
    expect(exported.changeLog).toMatchObject([{ id: 'change-свой', previous: 'Было свой', applied: 'Стало свой' }]);
    expect(exported.revisions).toMatchObject([{ commandId: 'command-свой', appliedText: 'Заголовок стал свой' }]);
    expect(exported.careerVector).toMatchObject({ answers: { goal: 'Цель свой' } });
    expect(exported.decisionProfile).toMatchObject({ citizenship: ['Гражданство свой'] });
    expect(exported.skillQuizAttempts).toMatchObject([{ id: 'attempt-свой', skillName: 'Навык свой' }]);
    expect(exported.interviewDesignSchemas).toEqual([
      { sessionId: 'session-свой', questionId: 'q1', schema: { nodes: ['Схема свой'] }, updatedAt: AT },
    ]);
    expect(exported.interviewReviewHelpful).toEqual([
      { sessionId: 'session-свой', questionId: 'q1', helpful: true, updatedAt: AT },
    ]);
    expect(exported.goalMarkers).toEqual([
      { kind: 'application_receipt', entityKey: 'receipt-свой', recordedAt: AT, evidenceKind: 'confirmation_url' },
    ]);
    expect(exported.importWalks).toEqual([
      { platform: 'hh', state: 'done', sections: ['Раздел свой'], updatedAt: AT },
    ]);
    expect(exported.consultantRejections).toMatchObject([{ proposalKey: 'proposal-свой', reason: 'Не подходит свой' }]);
    expect(JSON.stringify(exported)).not.toContain('чужой');
  });

  it('у нового кандидата история пустая', () => {
    const { store } = fileStore();
    const candidate = createCandidate(store);
    const exported = store.exportCandidate(candidate.id).profileHistory;
    expect(exported).toMatchObject({
      resumeVersions: [],
      media: [],
      changeLog: [],
      revisions: [],
      careerVector: null,
      decisionProfile: null,
      skillQuizAttempts: [],
      interviewDesignSchemas: [],
      interviewReviewHelpful: [],
      goalMarkers: [],
      importWalks: [],
      consultantRejections: [],
    });
  });
});
