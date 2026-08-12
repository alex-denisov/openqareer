import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendCoachTurn } from './coachApi';

describe('career coach turn API', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the current target as market context without choosing the phase', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            message: 'Проверим рынок.',
            phase: 'market',
            nextQuestion: null,
            completeness: { known: [], unknown: [] },
            safety: { needsHuman: false, reason: null },
            careerTrack: null,
            actionProposals: [],
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await sendCoachTurn({
      content: 'Что видно по рынку вакансий?',
      marketQuery: 'Руководитель продукта',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
      messageId: '22222222-2222-4222-8222-222222222222',
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      messageId: '22222222-2222-4222-8222-222222222222',
      content: 'Что видно по рынку вакансий?',
      marketQuery: 'Руководитель продукта',
    });
  });
});
