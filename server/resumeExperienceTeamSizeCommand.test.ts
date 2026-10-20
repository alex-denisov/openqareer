import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CareerActionProposal } from './domain/coach';
import { EMPTY_RESUME_DRAFT, type ResumeDraft } from './domain/resumeDraft';
import { createApp, candidateAuthorization, stores, successProvider } from './appTestHarness';
import type { CoachProvider } from './providers/coachProvider';

function providerWithProposal(proposal: CareerActionProposal): CoachProvider {
  return {
    async createTurn(input, idempotencyKey) {
      const turn = await successProvider.createTurn(input, idempotencyKey);
      return { ...turn, result: { ...turn.result, actionProposals: [proposal] } };
    },
  };
}

function teamSizeProposal(experienceId: string, messageId: string, proposedText: string) {
  return {
    kind: 'resume.revise',
    objective: 'Записать размер команды со слов кандидата.',
    evidenceRefs: [messageId],
    acceptanceCriteria: ['Изменён только размер команды выбранного места.'],
    expectedSignal: 'Оценка уровня видит размер команды.',
    measureAfter: '2026-10-28',
    risk: 'candidate_data_write',
    resumeRevision: {
      section: 'experience',
      experienceId,
      memoryId: null,
      field: 'teamSize',
      proposedText,
    },
  } as CareerActionProposal;
}

async function preparedTeamSizeCommand(proposedText: string) {
  const messageId = randomUUID();
  const turnIdempotencyKey = randomUUID();
  const experienceId = 'exp-fintech-lab';
  const app = await createApp(
    providerWithProposal(teamSizeProposal(experienceId, messageId, proposedText)),
  );
  const authorization = candidateAuthorization(app);
  const me = await app.inject({
    method: 'GET',
    url: '/api/v1/candidate/me',
    headers: { authorization },
  });
  const candidateId = me.json().data.candidate.id as string;
  const store = stores[stores.length - 1]!;
  store.importResumeEvidence(candidateId, {
    sourceLabel: 'LinkedIn',
    entries: [
      {
        memoryId: 'chronology-fintech',
        domain: 'responsibility',
        statement: 'Head of Engineering в «Финтех Лаб» с 03.2021.',
      },
    ],
  });
  store.changeMemory(candidateId, 'chronology-fintech', { action: 'confirm' });
  const draft: ResumeDraft = {
    ...EMPTY_RESUME_DRAFT,
    experience: [
      {
        id: experienceId,
        chronologyMemoryId: 'chronology-fintech',
        title: 'Head of Engineering',
        employer: 'Финтех Лаб',
        startDate: '2021-03',
        current: true,
        bulletMemoryIds: [],
      },
    ],
  };
  store.saveResumeDraft(candidateId, draft, []);
  await app.inject({
    method: 'POST',
    url: '/api/v1/coach/turn',
    headers: { authorization, 'idempotency-key': turnIdempotencyKey },
    payload: { messageId, content: 'В «Финтех Лаб» у меня 38 человек.' },
  });
  const commandId = randomUUID();
  const prepared = await app.inject({
    method: 'POST',
    url: '/api/v1/candidate/career-commands',
    headers: { authorization, origin: 'http://localhost:3000', 'idempotency-key': commandId },
    payload: { turnIdempotencyKey, proposalIndex: 0 },
  });
  return { app, authorization, candidateId, store, commandId, prepared };
}

describe('resume.revise experience team size (B540)', () => {
  it('proposes, applies with fresh evidence and reverts the team size', async () => {
    const { app, authorization, candidateId, store, commandId, prepared } =
      await preparedTeamSizeCommand('38');
    expect(prepared.statusCode).toBe(201);
    expect(prepared.json().data.executionTarget).toMatchObject({
      field: 'teamSize',
      currentText: '',
      proposedText: '38',
    });

    const approved = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
      headers: { authorization, origin: 'http://localhost:3000', 'idempotency-key': commandId },
    });
    expect(approved.json().data.status).toBe('completed_with_receipt');
    const applied = store.getSnapshot(candidateId).resume!.draft.experience[0]!;
    expect(applied.teamSize).toBe(38);
    expect(applied.chronologyMemoryId).not.toBe('chronology-fintech');
    expect(
      store.getSnapshot(candidateId).memory.find((item) => item.id === applied.chronologyMemoryId)
        ?.statement,
    ).toContain('Размер команды: 38 человек');

    const reverted = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/revert`,
      headers: { authorization, origin: 'http://localhost:3000' },
    });
    expect(reverted.statusCode).toBe(200);
    const restored = store.getSnapshot(candidateId).resume!.draft.experience[0]!;
    expect(restored.teamSize).toBeUndefined();
    expect(restored.chronologyMemoryId).toBe('chronology-fintech');
  });

  it('refuses a team size that is not a whole number of people', async () => {
    const { prepared } = await preparedTeamSizeCommand('около сорока');
    expect(prepared.statusCode).not.toBe(201);
  });
});
