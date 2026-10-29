import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import { OpenAICoachProvider } from './openAICoachProvider';

const input: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'personal',
  locale: 'ru-RU',
  phase: 'discovery',
  messages: [{ id: 'message-1', role: 'user', content: 'Я запускал продукт.' }],
};

const validOutput = {
  message: 'Сначала уточним масштаб запуска.',
  phase: 'evidence',
  memoryCandidates: [],
  nextQuestion: 'Сколько человек было в команде?',
  completeness: { known: ['Есть опыт запуска'], unknown: ['Масштаб'] },
  safety: { needsHuman: false, reason: null },
  careerTrack: null,
  actionProposals: [],
};

function finalResponse(text: string, status = 'completed') {
  return {
    id: 'resp-1',
    model: 'gpt-5.6-luna-2026-08-01',
    status,
    ...(status === 'incomplete' ? { incomplete_details: { reason: 'max_output_tokens' } } : {}),
    output: [{ type: 'message', content: [{ type: 'output_text', text }] }],
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 },
  };
}

function events(items: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of items) yield item;
    },
  };
}

function provider(
  create: (body: Record<string, unknown>, options: Record<string, unknown>) => unknown,
  timeoutMs?: number,
) {
  const client = { responses: { create } } as unknown as OpenAI;
  return new OpenAICoachProvider({
    apiKey: 'not-used-by-test',
    model: 'gpt-5.6-luna',
    client,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

describe('OpenAI coach provider streaming (29.10)', () => {
  it('streams the message text and validates the completed response', async () => {
    const json = JSON.stringify(validOutput);
    const bodies: Array<Record<string, unknown>> = [];
    const luna = provider(async (body) => {
      bodies.push(body);
      return events([
        { type: 'response.created' },
        { type: 'response.output_text.delta', delta: json.slice(0, 25) },
        { type: 'response.output_text.delta', delta: json.slice(25) },
        { type: 'response.completed', response: finalResponse(json) },
      ]);
    });
    const seen: string[] = [];

    const output = await luna.createTurn(input, 'key-stream', {
      onMessageText: (text) => seen.push(text),
    });

    expect(output.result).toEqual(validOutput);
    expect(output.usage.totalTokens).toBe(200);
    expect(bodies[0]).toMatchObject({ stream: true, store: false });
    expect(seen.at(-1)).toBe(validOutput.message);
    expect(seen.length).toBeGreaterThan(1);
  });

  it('keeps the incomplete diagnostic of a streamed response', async () => {
    const luna = provider(async () =>
      events([
        { type: 'response.incomplete', response: finalResponse('{"message":"Об', 'incomplete') },
      ]),
    );

    await expect(
      luna.createTurn(input, 'key-incomplete', { onMessageText: () => undefined }),
    ).rejects.toMatchObject({
      code: 'provider_output_invalid',
      diagnostic: 'response_incomplete_max_output_tokens',
    });
  });

  it('times out a stream the SDK ends quietly on abort, mid-body', async () => {
    const luna = provider(async (_body, options) => {
      const signal = options.signal as AbortSignal;
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: 'response.output_text.delta', delta: '{"message":"Нач' };
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        },
      };
    }, 30);

    await expect(
      luna.createTurn(input, 'key-quiet', { onMessageText: () => undefined }),
    ).rejects.toMatchObject({ code: 'provider_timeout' });
  });

  it('fails the stage when the stream reports an error', async () => {
    const luna = provider(async () =>
      events([{ type: 'error', code: 'server_error', message: 'x' }]),
    );

    await expect(
      luna.createTurn(input, 'key-error', { onMessageText: () => undefined }),
    ).rejects.toMatchObject({ code: 'provider_unavailable', retryable: true });
  });
});
