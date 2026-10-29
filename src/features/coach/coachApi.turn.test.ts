import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendCoachTurn } from './coachApi';
import {
  approveCareerCommand,
  getCareerCommand,
  getCareerCommands,
  prepareCareerCommand,
} from './careerCommandApi';

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

  it('prepares, approves and reads the same candidate-scoped command', async () => {
    const command = {
      schemaVersion: 'career-command-v1',
      commandId: '33333333-3333-4333-8333-333333333333',
      capability: 'application.submit',
      status: 'awaiting_approval',
      proposal: {
        kind: 'application.submit',
        objective: 'Отправить проверенный отклик.',
        evidenceRefs: ['message-1'],
        acceptanceCriteria: ['Получен receipt'],
        expectedSignal: 'Отклик принят',
        measureAfter: '2026-08-19',
        risk: 'external_side_effect',
      },
      execution: null,
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(command, 201))
      .mockResolvedValueOnce(jsonResponse({ ...command, status: 'queued' }))
      .mockResolvedValueOnce(jsonResponse({ ...command, status: 'queued' }))
      .mockResolvedValueOnce(jsonResponse([{ ...command, status: 'queued' }]));
    vi.stubGlobal('fetch', fetchMock);

    const prepared = await prepareCareerCommand({
      turnIdempotencyKey: '11111111-1111-4111-8111-111111111111',
      proposalIndex: 0,
      idempotencyKey: command.commandId,
    });
    const approved = await approveCareerCommand(command.commandId, {
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    });
    const stored = await getCareerCommand(command.commandId);
    const commands = await getCareerCommands();

    expect(prepared.status).toBe('awaiting_approval');
    expect(approved.status).toBe('queued');
    expect(stored.commandId).toBe(command.commandId);
    expect(commands).toHaveLength(1);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/v1/candidate/career-commands',
      `/api/v1/candidate/career-commands/${command.commandId}/approvals`,
      `/api/v1/candidate/career-commands/${command.commandId}`,
      '/api/v1/candidate/career-commands',
    ]);
  });
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify({ data }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('streamed coach turn (29.10)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const receipt = () =>
    new Response(JSON.stringify({ data: { status: 'pending', idempotencyKey: 'k' } }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' },
    });
  const final = { message: 'Ответ.', phase: 'role', actionProposals: [] };

  it('reads the stream after the receipt and returns its final result', async () => {
    const stream = new Response(
      `event: delta\ndata: {"text":"Отв"}\n\nevent: done\ndata: ${JSON.stringify({ data: final })}\n\n`,
      { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
    );
    const fetchMock = vi.fn().mockResolvedValueOnce(receipt()).mockResolvedValueOnce(stream);
    vi.stubGlobal('fetch', fetchMock);
    const seen: string[] = [];

    const result = await sendCoachTurn({ content: 'Вопрос', onMessageText: (text) => seen.push(text) });

    expect(result).toEqual(final);
    expect(seen).toEqual(['Отв']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the stored result when the stream is unavailable', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(receipt())
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: final }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const result = await sendCoachTurn({ content: 'Вопрос', onMessageText: () => undefined });

    expect(result).toEqual(final);
    expect(String(fetchMock.mock.calls[2][0])).toContain('/result');
  });
});
