import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CandidateStore } from './data/candidateStore';
import type { CareerActionProposal } from './domain/coach';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './domain/resumeDraft';
import { createApp, candidateAuthorization, stores, successProvider } from './appTestHarness';
import type { CoachProvider } from './providers/coachProvider';

function providerWithProposals(proposals: CareerActionProposal[]): CoachProvider {
  return {
    async createTurn(input, idempotencyKey) {
      const turn = await successProvider.createTurn(input, idempotencyKey);
      return {
        ...turn,
        result: { ...turn.result, actionProposals: proposals },
      };
    },
  };
}

function dateProposal(experienceId: string, messageId: string): CareerActionProposal {
  return {
    kind: 'resume.revise',
    objective: 'Исправить указанную кандидатом дату окончания работы.',
    evidenceRefs: [messageId],
    acceptanceCriteria: ['Изменена только выбранная дата опыта.'],
    expectedSignal: 'Период работы соответствует уточнению кандидата.',
    measureAfter: '2026-10-17',
    risk: 'candidate_data_write',
    resumeRevision: {
      section: 'experience',
      experienceId,
      memoryId: null,
      field: 'endDate',
      proposedText: '2021-01',
    },
  };
}

function seedExperience(
  store: CandidateStore,
  candidateId: string,
  experienceId: string,
  chronologyMemoryId: string,
  endDate: string,
): ResumeDraft {
  store.importResumeEvidence(candidateId, {
    sourceLabel: 'Дата в загруженном резюме',
    entries: [
      {
        memoryId: chronologyMemoryId,
        domain: 'responsibility',
        statement: 'В загруженном резюме указано окончание работы в 2021-02.',
      },
    ],
  });
  store.changeMemory(candidateId, chronologyMemoryId, { action: 'confirm' });
  const draft: ResumeDraft = {
    ...EMPTY_RESUME_DRAFT,
    experience: [
      {
        id: experienceId,
        chronologyMemoryId,
        title: 'Platform Engineer',
        employer: 'Fintech Lab',
        startDate: '2018-01',
        endDate,
        current: false,
        bulletMemoryIds: [],
      },
    ],
  };
  store.saveResumeDraft(candidateId, draft, []);
  return draft;
}

describe('resume.revise experience date fields', () => {
  it('applies an endDate with fresh candidate evidence, exports it, and reverts date and evidence', async () => {
    const turnIdempotencyKey = randomUUID();
    const messageId = randomUUID();
    const experienceId = 'exp-fintech-1';
    const previousChronologyMemoryId = 'chronology-fintech-imported';
    const proposal = dateProposal(experienceId, messageId);
    const app = await createApp(providerWithProposals([proposal]));
    const authorization = candidateAuthorization(app);
    const candidateResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { authorization },
    });
    const candidateId = candidateResponse.json().data.candidate.id as string;
    const store = stores[stores.length - 1]!;
    seedExperience(store, candidateId, experienceId, previousChronologyMemoryId, '2021-02');

    const initialResume = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    expect(initialResume.json().data.projection.master.experience[0].endDate).toMatchObject({
      value: '2021-02',
      memoryId: previousChronologyMemoryId,
    });

    const turn = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': turnIdempotencyKey },
      payload: {
        messageId,
        content: 'Дата окончания работы была 2021-01, исправь её в опыте.',
      },
    });
    expect(turn.statusCode).toBe(200);

    const commandId = randomUUID();
    const prepared = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
      payload: { turnIdempotencyKey, proposalIndex: 0 },
    });
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json().data.executionTarget).toMatchObject({
      section: 'experience',
      experienceId,
      field: 'endDate',
      currentText: '2021-02',
      proposedText: '2021-01',
    });

    const approved = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands/' + commandId + '/approvals',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
    });
    expect(approved.statusCode).toBe(200);
    expect(approved.json().data.status).toBe('completed_with_receipt');

    const afterApproval = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    const savedRole = afterApproval.json().data.draft.experience[0];
    expect(savedRole).toMatchObject({
      endDate: '2021-01',
      title: 'Platform Engineer',
      startDate: '2018-01',
      bulletMemoryIds: [],
    });
    const appliedChronologyMemoryId = savedRole.chronologyMemoryId as string;
    expect(appliedChronologyMemoryId).not.toBe(previousChronologyMemoryId);
    expect(afterApproval.json().data.projection.master.experience[0].endDate).toMatchObject({
      value: '2021-01',
      memoryId: appliedChronologyMemoryId,
    });
    const appliedChronology = store
      .getSnapshot(candidateId)
      .memory.find((memory) => memory.id === appliedChronologyMemoryId);
    expect(appliedChronology?.statement).toContain('Окончание: 2021-01');
    expect(appliedChronology?.sourceMessageIds).toHaveLength(1);
    expect(
      store
        .getSnapshot(candidateId)
        .memory.find((memory) => memory.id === previousChronologyMemoryId)?.statement,
    ).toContain('2021-02');

    const versionList = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume/versions?limit=20',
      headers: { authorization },
    });
    const versionId = randomUUID();
    const exported = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/resume/versions',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': versionId,
      },
      payload: {
        title: 'Platform Engineer',
        requirements: ['Platform'],
        expectedMasterRevision: versionList.json().data.currentMasterRevision,
      },
    });
    expect(exported.statusCode).toBe(201);
    const exportedRole = exported
      .json()
      .data.version.snapshot.document.experience.find(
        (entry: { readonly id: string }) => entry.id === experienceId,
      );
    expect(exportedRole?.endDate).toMatchObject({
      value: '2021-01',
      memoryId: appliedChronologyMemoryId,
    });

    const revision = store.profileRevisionRepo.getRevisionByCommandId(candidateId, commandId);
    expect(revision).toMatchObject({
      previousChronologyMemoryId,
      appliedChronologyMemoryId,
      previousText: '2021-02',
      appliedText: '2021-01',
    });
    const currentSnapshot = store.getSnapshot(candidateId);
    const changedChronologyDraft: ResumeDraft = {
      ...currentSnapshot.resume!.draft,
      experience: currentSnapshot.resume!.draft.experience.map((entry) =>
        entry.id === experienceId
          ? { ...entry, chronologyMemoryId: previousChronologyMemoryId }
          : entry,
      ),
    };
    store.saveResumeDraft(
      candidateId,
      changedChronologyDraft,
      currentSnapshot.resume?.evidenceSnapshot ?? [],
    );
    const blockedRevert = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands/' + commandId + '/revert',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(blockedRevert.statusCode).toBe(409);
    expect(blockedRevert.json().error.code).toBe('resume_revision_stale');
    expect(store.getSnapshot(candidateId).resume?.draft.experience[0]?.endDate).toBe('2021-01');

    store.saveResumeDraft(
      candidateId,
      currentSnapshot.resume!.draft,
      currentSnapshot.resume?.evidenceSnapshot ?? [],
    );
    const reverted = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands/' + commandId + '/revert',
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(reverted.statusCode).toBe(200);
    const afterRevert = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    expect(afterRevert.json().data.draft.experience[0]).toMatchObject({
      endDate: '2021-02',
      chronologyMemoryId: previousChronologyMemoryId,
    });
    expect(afterRevert.json().data.projection.master.experience[0].endDate).toMatchObject({
      value: '2021-02',
      memoryId: previousChronologyMemoryId,
    });
    expect(
      store
        .getSnapshot(candidateId)
        .memory.find((memory) => memory.id === appliedChronologyMemoryId),
    ).toBeUndefined();
  });

  it('rejects stale approval and an experience date target belonging to another candidate', async () => {
    const messageId = randomUUID();
    const turnIdempotencyKey = randomUUID();
    const experienceId = 'exp-date-conflict';
    const chronologyMemoryId = 'chronology-date-conflict';
    const proposal = dateProposal(experienceId, messageId);
    const crossCandidateMessageId = randomUUID();
    const crossCandidateProposal = dateProposal(experienceId, crossCandidateMessageId);
    const app = await createApp(providerWithProposals([proposal, crossCandidateProposal]));
    const authorization = candidateAuthorization(app);
    const candidateResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { authorization },
    });
    const candidateId = candidateResponse.json().data.candidate.id as string;
    const store = stores[stores.length - 1]!;
    const originalDraft = seedExperience(
      store,
      candidateId,
      experienceId,
      chronologyMemoryId,
      '2021-02',
    );

    await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': turnIdempotencyKey },
      payload: { messageId, content: 'Исправь дату окончания на 2021-01.' },
    });
    const commandId = randomUUID();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
      payload: { turnIdempotencyKey, proposalIndex: 0 },
    });
    expect(created.statusCode).toBe(201);

    store.saveResumeDraft(
      candidateId,
      {
        ...originalDraft,
        experience: [{ ...originalDraft.experience[0]!, endDate: '2021-03' }],
      },
      [],
    );
    const staleApproval = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands/' + commandId + '/approvals',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
    });
    expect(staleApproval.statusCode).toBe(409);
    expect(staleApproval.json().error.code).toBe('resume_revision_stale');
    expect(store.profileRevisionRepo.getRevisionByCommandId(candidateId, commandId)).toBeNull();
    expect(store.getSnapshot(candidateId).resume?.draft.experience[0]?.endDate).toBe('2021-03');

    const otherCandidate = store.createCandidate({
      dataClass: 'synthetic',
      locale: 'ru-RU',
    });
    const otherAuthorization = 'Bearer ' + otherCandidate.accessToken;
    const otherCandidateResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { authorization: otherAuthorization },
    });
    const otherCandidateId = otherCandidateResponse.json().data.candidate.id as string;
    expect(otherCandidateId).not.toBe(candidateId);
    const otherTurnId = randomUUID();
    await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization: otherAuthorization, 'idempotency-key': otherTurnId },
      payload: {
        messageId: crossCandidateMessageId,
        content: 'Исправь дату окончания в моём резюме.',
      },
    });
    const crossCandidateCommand = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands',
      headers: {
        authorization: otherAuthorization,
        origin: 'http://localhost:3000',
        'idempotency-key': randomUUID(),
      },
      payload: { turnIdempotencyKey: otherTurnId, proposalIndex: 1 },
    });
    expect(crossCandidateCommand.statusCode).toBe(422);
    expect(crossCandidateCommand.json().error.code).toBe('resume_revision_target_stale');
    expect(store.getSnapshot(candidateId).resume?.draft.experience[0]?.endDate).toBe('2021-03');
    expect(store.getSnapshot(otherCandidateId).resume).toBeNull();
  });
});
