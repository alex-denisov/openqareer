import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CareerActionProposal } from './domain/coach';
import type { CoachProvider } from './providers/coachProvider';
import { createApp, candidateAuthorization, successProvider } from './appTestHarness';

function providerWithProposals(proposals: CareerActionProposal[]): CoachProvider {
  return {
    async createTurn(input, idempotencyKey) {
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
      payload: {
        turnIdempotencyKey,
        proposalIndex: 0,
        executionTarget: {
          section: 'about',
          proposedText: 'Выдуманный текст',
        },
      },
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
      evidenceRefs: [messageId],
      acceptanceCriteria: ['Текст обновлён'],
      expectedSignal: 'Готово',
      measureAfter: '2026-10-01',
      risk: 'candidate_data_write',
    };
    const app = await createApp(providerWithProposals([proposal]));
    const authorization = candidateAuthorization(app);

    await app.inject({
      method: 'POST',
      url: '/api/v1/coach/turn',
      headers: { authorization, 'idempotency-key': turnIdempotencyKey },
      payload: { messageId, content: 'Обнови О себе' },
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
      payload: {
        turnIdempotencyKey,
        proposalIndex: 0,
        executionTarget: {
          section: 'about',
          proposedText: '15 лет опыта в финтех-платформах.',
        },
      },
    });

    expect(createRes.statusCode).toBe(201);
    const command = createRes.json().data;
    expect(command.status).toBe('awaiting_approval');
    expect(command.capability).toBe('resume.revise');

    // До одобрения профиль кандидата НЕ изменён
    const beforeApproval = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    expect(beforeApproval.json().data?.draft?.candidate?.about ?? '').not.toContain('15 лет опыта в финтех-платформах.');

    // Кандидат нажимает «Принять» (одобряет команду)
    const approvalId = randomUUID();
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/v1/candidate/career-commands/${commandId}/approvals`,
      headers: {
        authorization,
        origin: 'http://localhost:3000',
        'idempotency-key': approvalId,
      },
    });

    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().data.status).toBe('completed_with_receipt');

    // После одобрения профиль обновлён
    const afterApproval = await app.inject({
      method: 'GET',
      url: '/api/v1/candidate/resume',
      headers: { authorization },
    });
    expect(afterApproval.json().data.draft.candidate.about).toBe('15 лет опыта в финтех-платформах.');

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
    expect(afterRevert.json().data?.draft?.candidate?.about ?? '').toBe('');
  });
});

