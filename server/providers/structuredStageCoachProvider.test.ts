import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import type { BulkLlmInput } from './bulkLlmClient';
import { CoachProviderError, type CoachProvider, type CoachProviderResult } from './coachProvider';
import { StructuredStageCoachProvider } from './structuredStageCoachProvider';

const STAGE: CoachTurnInput = {
  candidateReference: 'candidate-1',
  dataClass: 'synthetic',
  locale: 'ru-RU',
  phase: 'role',
  activeRole: 'career_expert',
  internalPurpose: 'structured-stage',
  stageContext: JSON.stringify({ task: 'Generate profile suggestions', outputSchema: {} }),
  messages: [{ id: 'answer-1', role: 'user', content: 'Отвечал за операции.' }],
};
const CHAT: CoachTurnInput = { ...STAGE, internalPurpose: undefined, stageContext: undefined };

function queueResult(message: string): CoachProviderResult {
  return {
    provider: 'openai',
    model: 'gpt-5.6-luna',
    responseId: 'queue',
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    result: {
      message,
      phase: 'role',
      memoryCandidates: [],
      nextQuestion: null,
      completeness: { known: [], unknown: [] },
      safety: { needsHuman: false, reason: null },
    } as unknown as CoachProviderResult['result'],
    routing: { fallbackUsed: false, attempts: [{ provider: 'openai', status: 'succeeded' }] },
  };
}

function rig(bulkAnswer: (input: BulkLlmInput) => Promise<string>) {
  const bulk = {
    complete: vi.fn(async (input: BulkLlmInput) => ({
      content: await bulkAnswer(input),
      model: 'deepseek/deepseek-v4-flash',
      provider: 'deepinfra/fp8',
      usage: { cost: 0.001, promptTokens: 1, cachedTokens: 0, completionTokens: 1 },
    })),
  };
  const fallback: CoachProvider & { createTurn: ReturnType<typeof vi.fn> } = {
    createTurn: vi.fn(async () => queueResult('{"from":"queue"}')),
  };
  const provider = new StructuredStageCoachProvider({ bulk, fallback });
  return { bulk, fallback, provider };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('StructuredStageCoachProvider (B564)', () => {
  it('leaves the consultant chat on its own queue', async () => {
    const { bulk, fallback, provider } = rig(async () => '{}');

    await provider.createTurn(CHAT, 'key-chat');

    expect(bulk.complete).not.toHaveBeenCalled();
    expect(fallback.createTurn).toHaveBeenCalledTimes(1);
  });

  it('asks the pinned bulk model first, with reasoning off and the stage as data', async () => {
    const { bulk, fallback, provider } = rig(async () => '{"suggestions":[]}');

    const output = await provider.createTurn(STAGE, 'key-stage');

    expect(fallback.createTurn).not.toHaveBeenCalled();
    expect(output.result.message).toBe('{"suggestions":[]}');
    expect(output.routing?.attempts).toEqual([
      { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash', status: 'succeeded' },
    ]);
    const input = bulk.complete.mock.calls[0]![0];
    expect(input).toMatchObject({ task: 'structured-stage', dataClass: 'candidate' });
    expect(JSON.parse(input.input)).toMatchObject({
      stageContext: { task: 'Generate profile suggestions' },
      messages: [{ id: 'answer-1', content: 'Отвечал за операции.' }],
    });
  });

  it('falls back to the queue when the bulk answer is rejected or fails', async () => {
    const rejected = rig(async () => 'не JSON');
    const output = await rejected.provider.createTurn(STAGE, 'key-1', {
      accept: (result) => result.message.startsWith('{'),
    });
    expect(output.result.message).toBe('{"from":"queue"}');
    expect(output.routing?.attempts[0]).toMatchObject({
      provider: 'openrouter',
      status: 'failed',
      code: 'provider_output_invalid',
    });

    const failing = rig(async () => {
      throw new Error('Bulk budget exceeded');
    });
    await failing.provider.createTurn(STAGE, 'key-2');
    expect(failing.fallback.createTurn).toHaveBeenCalledTimes(1);
  });

  it('gives the bulk model 45 s and the whole step 150 s, inside the 190 s server limit', async () => {
    vi.useFakeTimers();
    const never = () => new Promise<string>(() => undefined);
    const { fallback, provider } = rig(never);
    fallback.createTurn.mockImplementation(() => new Promise(() => undefined));

    const turn = provider.createTurn(STAGE, 'key-slow');
    const outcome = turn.then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(44_999);
    expect(fallback.createTurn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fallback.createTurn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(105_000);

    const error = await outcome;
    expect(error).toBeInstanceOf(CoachProviderError);
    expect(error).toMatchObject({ code: 'provider_timeout' });
  });
});
