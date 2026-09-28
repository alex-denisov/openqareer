import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { CareerActionProposal, CoachTurnInput } from './domain/coach';
import type { CoachProvider } from './providers/coachProvider';
import { EMPTY_RESUME_DRAFT } from './domain/resumeDraft';
import { createApp, candidateAuthorization, stores, successProvider } from './appTestHarness';

function providerWithProposals(
  proposals: CareerActionProposal[],
  onInput?: (input: CoachTurnInput) => void,
): CoachProvider {
  return {
    async createTurn(input, idempotencyKey) {
      onInput?.(input);
      const turn = await successProvider.createTurn(input, idempotencyKey);
      return {
        ...turn,
        result: {
          ...turn.result,
          actionProposals: proposals,
        },
      };
    },
  };
}

describe('resume.revise career command (C58)', () => {
  it('отклоняет команду, если evidenceRefs ссылается на несуществующие факты (модель ничего не выдумывает)', async () => {
    const turnIdempotencyKey = randomUUID();
    const messageId = randomUUID();
    const proposal: CareerActionProposal = {
      kind: 'resume.revise',
      objective: 'Добавить опыт масштабирования в О себе',
      evidenceRefs: ['fake-ref-999'],
      acceptanceCriteria: ['Опыт отражён в профиле'],
      expectedSignal: 'Сильный профиль',
      measureAfter: '2026-10-01',
      risk: 'candidate_data_write',
      resumeRevision: {
        section: 'about',
        experienceId: null,
        memoryId: null,
        proposedText: 'Выдуманный текст',
      },
    };
    const app = await createApp(providerWithProposals([proposal]));
    const authorization = candidateAuthorization(app);

    const turn = await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': turnIdempotencyKey },
      payload: { messageId, content: 'Помоги с разделом О себе' },
    });
    expect(turn.statusCode).toBe(200);

    const commandId = randomUUID();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
      payload: { turnIdempotencyKey, proposalIndex: 0 },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error.code).toBe('career_command_unknown_evidence');
  });

  it('создаёт команду resume.revise в статусе awaiting_approval и исполняет её только после явного одобрения', async () => {
    const turnIdempotencyKey = randomUUID();
    const messageId = randomUUID();
    const proposal: CareerActionProposal = {
      kind: 'resume.revise',
      objective: 'Сформулировать блок О себе',
      evidenceRefs: ['memory:fact-about-1'],
      acceptanceCriteria: ['Текст обновлён'],
      expectedSignal: 'Готово',
      measureAfter: '2026-10-01',
      risk: 'candidate_data_write',
      resumeRevision: {
        section: 'about',
        experienceId: null,
        memoryId: null,
        proposedText: '15 лет опыта в финтех-платформах.',
      },
    };
    let observedResumeContext: CoachTurnInput['resumeContext'];
    const app = await createApp(
      providerWithProposals([proposal], (input) => {
        observedResumeContext = input.resumeContext;
      }),
    );
    const authorization = candidateAuthorization(app);

    const snapshot = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { authorization },
    });
    const candidateId = snapshot.json().data.candidate.id as string;
    const store = stores[stores.length - 1];
    store.importResumeEvidence(candidateId, {
      sourceLabel: 'Факт из профиля кандидата',
      entries: [
        {
          memoryId: 'fact-about-1',
          domain: 'responsibility',
          statement: '15 лет строю платформы в финтехе.',
        },
      ],
    });
    store.saveResumeDraft(
      candidateId,
      {
        ...EMPTY_RESUME_DRAFT,
        candidate: { ...EMPTY_RESUME_DRAFT.candidate, about: 'Руководила платформами в финтехе.' },
      },
      [],
    );

    await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': turnIdempotencyKey },
      payload: {
        messageId,
        content: 'Обнови раздел «Обо мне»; 15 лет строю платформы в финтехе.',
      },
    });
    expect(observedResumeContext).toMatchObject({
      about: 'Руководила платформами в финтехе.',
      headline: null,
      experiences: [],
    });

    const commandId = randomUUID();
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
      payload: { turnIdempotencyKey, proposalIndex: 0 },
    });

    expect(createRes.statusCode).toBe(201);
    const command = createRes.json().data;
    expect(command.status).toBe('awaiting_approval');
    expect(command.capability).toBe('resume.revise');
    expect(command.executionTarget).toMatchObject({
      section: 'about',
      currentText: 'Руководила платформами в финтехе.',
      proposedText: '15 лет опыта в финтех-платформах.',
    });

    // До одобрения профиль кандидата НЕ изменён
    const beforeApproval = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    expect(beforeApproval.json().data?.draft?.candidate?.about).toBe(
      'Руководила платформами в финтехе.',
    );

    // Кандидат нажимает «Принять» (одобряет команду)
    const approvalId = randomUUID();
    const revisionRepo = store.profileRevisionRepo;
    const recordRevision = vi.spyOn(revisionRepo, 'recordRevision').mockImplementation(() => {
      throw new Error('journal write failed');
    });
    const failedApply = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': approvalId,
      },
    });

    expect(failedApply.statusCode).toBe(500);
    const unchangedAfterFailure = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    expect(unchangedAfterFailure.json().data.draft.candidate.about).toBe(
      'Руководила платформами в финтехе.',
    );
    recordRevision.mockRestore();

    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': approvalId,
      },
    });

    expect(approveRes.statusCode, JSON.stringify(approveRes.json())).toBe(200);
    expect(approveRes.json().data.status).toBe('completed_with_receipt');

    // После одобрения профиль обновлён
    const afterApproval = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    expect(afterApproval.json().data.draft.candidate.about).toBe(
      '15 лет опыта в финтех-платформах.',
    );
    expect(
      store.getSnapshot(candidateId).memory.find((item) => item.id === 'fact-about-1')?.status,
    ).toBe('confirmed');
    expect(approveRes.json().data.execution).toMatchObject({
      status: 'completed_with_receipt',
      connector: {
        id: 'openqareer-profile-revision',
        transport: 'internal',
        evidenceKind: 'candidate_confirmation',
      },
    });

    // Откат правки (revert)
    const revertRes = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/revert`,
      headers: {
        authorization,
        origin: 'http://localhost:3000',
      },
    });
    expect(revertRes.statusCode).toBe(200);

    // После отката текст вернулся к исходному
    const afterRevert = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    expect(afterRevert.json().data?.draft?.candidate?.about).toBe(
      'Руководила платформами в финтехе.',
    );
    const commandsAfterRevert = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/career-commands',
      headers: { authorization },
    });
    expect(commandsAfterRevert.json().data[0].profileRevisionReverted).toBe(true);
  });

  it('rejects a stale experience target and preserves a later candidate edit on revert', async () => {
    const turnIdempotencyKey = randomUUID();
    const messageId = randomUUID();
    const staleProposal: CareerActionProposal = {
      kind: 'resume.revise',
      objective: 'Уточнить должность в опыте',
      evidenceRefs: [messageId],
      acceptanceCriteria: ['Раздел опыта обновлён'],
      expectedSignal: 'Должность точнее отражает подтверждённые факты.',
      measureAfter: '2026-10-01',
      risk: 'candidate_data_write',
      resumeRevision: {
        section: 'experience',
        experienceId: 'missing-experience',
        memoryId: null,
        proposedText: 'Ведущий инженер',
      },
    };
    const app = await createApp(providerWithProposals([staleProposal]));
    const authorization = candidateAuthorization(app);
    await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': turnIdempotencyKey },
      payload: { messageId, content: 'Обнови опыт работы в резюме.' },
    });
    const staleCommand = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands',
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': randomUUID(),
      },
      payload: { turnIdempotencyKey, proposalIndex: 0 },
    });
    expect(staleCommand.statusCode).toBe(422);
    expect(staleCommand.json().error.code).toBe('resume_revision_target_stale');

    const rollbackKey = randomUUID();
    const rollbackMessage = randomUUID();
    const aboutProposal: CareerActionProposal = {
      ...staleProposal,
      objective: 'Уточнить блок «Обо мне»',
      evidenceRefs: [rollbackMessage],
      resumeRevision: {
        section: 'about',
        experienceId: null,
        memoryId: null,
        proposedText: 'Руководила финтех-платформами.',
      },
    };
    const rollbackApp = await createApp(providerWithProposals([aboutProposal]));
    const rollbackAuthorization = candidateAuthorization(rollbackApp);
    const snapshot = await rollbackApp.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { authorization: rollbackAuthorization },
    });
    const candidateId = snapshot.json().data.candidate.id as string;
    const store = stores[stores.length - 1]!;
    const originalDraft = {
      ...EMPTY_RESUME_DRAFT,
      candidate: { ...EMPTY_RESUME_DRAFT.candidate, about: 'Исходный текст.' },
    };
    store.saveResumeDraft(candidateId, originalDraft, []);
    await rollbackApp.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization: rollbackAuthorization, 'idempotency-key': rollbackKey },
      payload: { messageId: rollbackMessage, content: 'Перепиши мой профиль в резюме.' },
    });
    const commandId = randomUUID();
    const prepared = await rollbackApp.inject({
      method: 'POST',
      url: '/api/v1/candidate/career-commands',
      headers: {
        authorization: rollbackAuthorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
      payload: { turnIdempotencyKey: rollbackKey, proposalIndex: 0 },
    });
    expect(prepared.statusCode).toBe(201);
    const approved = await rollbackApp.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
      headers: {
        authorization: rollbackAuthorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
    });
    expect(approved.statusCode).toBe(200);

    store.saveResumeDraft(
      candidateId,
      {
        ...originalDraft,
        candidate: { ...originalDraft.candidate, about: 'Кандидат внёс более позднюю правку.' },
      },
      [],
    );
    const reverted = await rollbackApp.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/revert`,
      headers: { authorization: rollbackAuthorization, origin: 'http://localhost:3000' },
    });
    expect(reverted.statusCode).toBe(409);
    const afterConflict = await rollbackApp.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization: rollbackAuthorization },
    });
    expect(afterConflict.json().data.draft.candidate.about).toBe(
      'Кандидат внёс более позднюю правку.',
    );
  });

  it('revises the confirmed experience fact itself and restores it through the profile revision', async () => {
    const turnIdempotencyKey = randomUUID();
    const messageId = randomUUID();
    const experienceId = 'exp-platform-1';
    const memoryId = 'fact-kubernetes-1';
    const originalFact = 'Поддерживала внутреннюю платформу разработки.';
    const proposal: CareerActionProposal = {
      kind: 'resume.revise',
      objective: 'Подтвердить опыт работы с Kubernetes.',
      evidenceRefs: [`memory:${memoryId}`],
      acceptanceCriteria: ['Формулировка опирается на существующий факт.'],
      expectedSignal: 'Требование вакансии отражено в опыте.',
      measureAfter: '2026-10-01',
      risk: 'candidate_data_write',
      resumeRevision: {
        section: 'experience',
        experienceId,
        memoryId,
        proposedText: 'Поддерживала внутреннюю платформу разработки на Kubernetes.',
      },
    };
    const app = await createApp(providerWithProposals([proposal]));
    const authorization = candidateAuthorization(app);
    const candidateResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { authorization },
    });
    const candidateId = candidateResponse.json().data.candidate.id as string;
    const store = stores[stores.length - 1]!;
    store.importResumeEvidence(candidateId, {
      sourceLabel: 'Факт из профиля кандидата',
      entries: [{ memoryId, domain: 'responsibility', statement: originalFact }],
    });
    store.changeMemory(candidateId, memoryId, { action: 'confirm' });
    store.saveResumeDraft(
      candidateId,
      {
        ...EMPTY_RESUME_DRAFT,
        experience: [
          {
            id: experienceId,
            chronologyMemoryId: 'chronology-platform-1',
            title: 'Platform Engineer',
            employer: 'Acme',
            current: true,
            bulletMemoryIds: [memoryId],
          },
        ],
      },
      [],
    );

    await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': turnIdempotencyKey },
      payload: {
        messageId,
        content: 'Для вакансии проверь мой опыт Kubernetes и предложи правку в разделе опыта.',
      },
    });
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
      memoryId,
      currentText: originalFact,
      proposedText: proposal.resumeRevision?.proposedText,
    });
    const beforeApproval = store.getSnapshot(candidateId);
    expect(beforeApproval.memory.find((fact) => fact.id === memoryId)?.statement).toBe(
      originalFact,
    );

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': commandId,
      },
    });
    expect(approved.statusCode).toBe(200);
    const afterApproval = store.getSnapshot(candidateId);
    expect(afterApproval.memory.find((fact) => fact.id === memoryId)).toMatchObject({
      statement: proposal.resumeRevision?.proposedText,
      status: 'confirmed',
    });
    expect(afterApproval.resume?.draft.experience[0]).toMatchObject({
      id: experienceId,
      title: 'Platform Engineer',
      bulletMemoryIds: [memoryId],
    });

    const reverted = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/revert`,
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(reverted.statusCode).toBe(200);
    expect(
      store.getSnapshot(candidateId).memory.find((fact) => fact.id === memoryId),
    ).toMatchObject({
      statement: originalFact,
      status: 'confirmed',
    });
  });

  it('stores a candidate-authored experience fact as confirmed and attaches it to the selected position', async () => {
    const app = await createApp();
    const authorization = candidateAuthorization(app);
    const candidateResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/me',
      headers: { authorization },
    });
    const candidateId = candidateResponse.json().data.candidate.id as string;
    const store = stores[stores.length - 1]!;
    const experienceId = 'exp-manual-1';
    store.saveResumeDraft(
      candidateId,
      {
        ...EMPTY_RESUME_DRAFT,
        experience: [
          {
            id: experienceId,
            chronologyMemoryId: 'chronology-manual-1',
            title: 'Platform Engineer',
            employer: 'Acme',
            current: true,
            bulletMemoryIds: [],
          },
        ],
      },
      [],
    );
    const memoryId = randomUUID();
    const payload = {
      statement: 'Развернула три Kubernetes-кластера и настроила резервирование.',
      experienceId,
    };
    const headers = {
      authorization,
      origin: 'http://localhost:3000',
      'idempotency-key': memoryId,
    };

    const added = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/experience-facts',
      headers,
      payload,
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().data.memory).toMatchObject({
      id: memoryId,
      statement: payload.statement,
      status: 'confirmed',
      domain: 'responsibility',
      confidence: 'candidate-confirmed',
    });
    expect(store.getSnapshot(candidateId).resume?.draft.experience[0]?.bulletMemoryIds).toEqual([
      memoryId,
    ]);

    const repeated = await app.inject({
      method: 'POST',
      url: '/api/v1/candidate/experience-facts',
      headers,
      payload,
    });
    expect(repeated.statusCode).toBe(200);
    expect(
      store.getSnapshot(candidateId).memory.filter((fact) => fact.id === memoryId),
    ).toHaveLength(1);
  });
});
