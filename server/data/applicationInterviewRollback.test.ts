import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { SqliteCandidateStore } from './sqliteCandidateStore';

const NOW = '2026-11-05T10:00:00.000Z';
const FIRST_SLOT = '2099-12-01T00:00:00.000Z';
const NEW_SLOT = '2099-12-10T00:00:00.000Z';

function storeWithInterview() {
  const store = new SqliteCandidateStore({
    databasePath: ':memory:',
    encryptionKey: randomBytes(32),
  });
  const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const application = store.createApplication(candidate.id, {
    stage: 'saved',
    vacancy: { title: 'Head of Platform', company: 'Гринкод', url: 'https://example.test/v', source: 'other' },
  });
  const interview = store.createApplicationInterview(candidate.id, application.id, {
    round: 1,
    scheduledAt: FIRST_SLOT,
  });
  store.patchApplicationInterview(candidate.id, application.id, interview.id, {
    prep: 'Заметки подготовки',
    debrief: 'Что спросили',
  });
  return { store, candidateId: candidate.id, applicationId: application.id, interviewId: interview.id };
}

function view(ctx: ReturnType<typeof storeWithInterview>) {
  const found = ctx.store
    .listApplications(ctx.candidateId, { now: NOW })
    .find((application) => application.id === ctx.applicationId);
  if (!found) throw new Error('application not found');
  return found;
}

function rollBack(ctx: ReturnType<typeof storeWithInterview>) {
  ctx.store.patchApplication(ctx.candidateId, ctx.applicationId, {
    expectedVersion: view(ctx).version,
    stage: 'saved',
    occurredAt: NOW,
  });
}

describe('rolling a response back from «Интервью» (B511 Д8)', () => {
  it('shows the slot while the stage is «Интервью»', () => {
    const ctx = storeWithInterview();
    expect(view(ctx).stage).toBe('interview');
    expect(view(ctx).nearestInterview?.scheduledAt).toBe(FIRST_SLOT);
  });

  it('leaves no interview on the response and no date for the row after the rollback', () => {
    const ctx = storeWithInterview();
    rollBack(ctx);
    const rolled = view(ctx);
    expect(rolled.stage).toBe('saved');
    expect(rolled.nearestInterview).toBeNull();
    expect(rolled.interviewScheduledAt).toEqual([]);
  });

  it('loses nothing: the date, the prep notes and the debrief stay stored', () => {
    const ctx = storeWithInterview();
    rollBack(ctx);
    const stored = ctx.store.patchApplicationInterview(
      ctx.candidateId,
      ctx.applicationId,
      ctx.interviewId,
      {},
    );
    expect(stored).toMatchObject({
      scheduledAt: FIRST_SLOT,
      prep: 'Заметки подготовки',
      debrief: 'Что спросили',
    });
  });

  it('moves the same interview to the new date on return, keeping its notes', () => {
    const ctx = storeWithInterview();
    rollBack(ctx);
    const returned = ctx.store.createApplicationInterview(ctx.candidateId, ctx.applicationId, {
      round: 1,
      scheduledAt: NEW_SLOT,
    });
    expect(returned.id).toBe(ctx.interviewId);
    expect(returned.prep).toBe('Заметки подготовки');
    expect(view(ctx).nearestInterview?.scheduledAt).toBe(NEW_SLOT);
    expect(view(ctx).interviewScheduledAt).toEqual([NEW_SLOT]);
  });

  it('keeps a second interview a second interview while the stage stays «Интервью»', () => {
    const ctx = storeWithInterview();
    const second = ctx.store.createApplicationInterview(ctx.candidateId, ctx.applicationId, {
      round: 2,
      scheduledAt: NEW_SLOT,
    });
    expect(second.id).not.toBe(ctx.interviewId);
    expect(view(ctx).nearestInterview?.scheduledAt).toBe(FIRST_SLOT);
  });

  it('keeps the interview on a date-only slot through the day of the interview', () => {
    const ctx = storeWithInterview();
    const sameDay = ctx.store
      .listApplications(ctx.candidateId, { now: '2099-12-01T15:00:00.000Z' })
      .find((application) => application.id === ctx.applicationId);
    expect(sameDay?.nearestInterview?.scheduledAt).toBe(FIRST_SLOT);
  });
});
