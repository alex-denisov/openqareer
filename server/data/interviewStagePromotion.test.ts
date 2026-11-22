import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CandidateStore } from './candidateStore';
import { SqliteCandidateStore } from './sqliteCandidateStore';

const SLOT = '2099-12-01T08:00:00.000Z';
const OTHER_SLOT = '2099-12-05T08:00:00.000Z';

function storeWithResponse() {
  const store = new SqliteCandidateStore({ databasePath: ':memory:', encryptionKey: randomBytes(32) });
  const candidate = store.createCandidate({ dataClass: 'synthetic', locale: 'ru-RU' });
  const application = store.createApplication(candidate.id, {
    stage: 'applied',
    vacancy: { title: 'GenAI Architect', company: 'Himalayas', url: 'https://example.test/v', source: 'other' },
  });
  return { store, candidateId: candidate.id, applicationId: application.id };
}

type Ctx = ReturnType<typeof storeWithResponse>;

function view(ctx: Ctx) {
  const found = ctx.store.listApplications(ctx.candidateId).find((row) => row.id === ctx.applicationId);
  if (!found) throw new Error('application not found');
  return found;
}

function addInterview(ctx: Ctx, scheduledAt = SLOT) {
  return ctx.store.createApplicationInterview(ctx.candidateId, ctx.applicationId, { round: 1, scheduledAt });
}

function remove(ctx: Ctx, interviewId: string) {
  return (ctx.store as CandidateStore).deleteApplicationInterview?.(ctx.candidateId, ctx.applicationId, interviewId);
}

describe('deleting the interview that moved the response to «Интервью»', () => {
  it('puts the stage, reached stages and the funnel back as they were before', () => {
    const ctx = storeWithResponse();
    const before = view(ctx);
    const funnelBefore = ctx.store.applicationFunnel(ctx.candidateId);
    const interview = addInterview(ctx);
    expect(view(ctx).stage).toBe('interview');

    expect(remove(ctx, interview.id)).toBe(true);

    const after = view(ctx);
    expect(after.stage).toBe('applied');
    expect(after.reachedStages).toEqual(before.reachedStages);
    expect(after.stageChangedAt).toBe(before.stageChangedAt);
    expect(ctx.store.applicationFunnel(ctx.candidateId)).toEqual(funnelBefore);
  });

  it('dates the move to «Интервью» now, not on the future interview day', () => {
    const ctx = storeWithResponse();
    const startedAt = Date.now();
    addInterview(ctx);
    const changedAt = Date.parse(view(ctx).stageChangedAt);
    expect(changedAt).toBeGreaterThanOrEqual(startedAt - 1_000);
    expect(changedAt).toBeLessThan(Date.parse(SLOT));
  });

  it('keeps «Интервью» while another interview of the response is still there', () => {
    const ctx = storeWithResponse();
    const first = addInterview(ctx);
    addInterview(ctx, OTHER_SLOT);
    remove(ctx, first.id);
    expect(view(ctx).stage).toBe('interview');
  });

  it('keeps a stage the candidate set after the interview was added', () => {
    const ctx = storeWithResponse();
    const interview = addInterview(ctx);
    ctx.store.patchApplication(ctx.candidateId, ctx.applicationId, {
      expectedVersion: view(ctx).version,
      stage: 'offer',
    });
    remove(ctx, interview.id);
    expect(view(ctx).stage).toBe('offer');
  });

  it('keeps «Интервью» the candidate chose before adding the interview', () => {
    const ctx = storeWithResponse();
    ctx.store.patchApplication(ctx.candidateId, ctx.applicationId, {
      expectedVersion: view(ctx).version,
      stage: 'interview',
    });
    const interview = addInterview(ctx);
    remove(ctx, interview.id);
    expect(view(ctx).stage).toBe('interview');
    expect(view(ctx).reachedStages).toContain('interview');
  });
});
