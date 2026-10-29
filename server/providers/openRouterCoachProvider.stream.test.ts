import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import { OpenRouterCoachProvider } from './openRouterCoachProvider';

const personalInput: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'personal',
  locale: 'ru-RU',
  phase: 'discovery',
  messages: [{ id: 'message-1', role: 'user', content: 'Тестовый кандидат запускал продукт.' }],
};

const validOutput = {
  message: 'Уточним масштаб запуска.',
  phase: 'evidence',
  memoryCandidates: [],
  nextQuestion: 'Сколько человек было в команде?',
  completeness: { known: ['Есть опыт запуска'], unknown: ['Масштаб'] },
  safety: { needsHuman: false, reason: null },
  careerTrack: null,
  actionProposals: [],
};

function chunk(content: string | undefined, extra: Record<string, unknown> = {}) {
  return {
    id: 'gen-1',
    model: 'deepseek/deepseek-v4.1-flash-1017',
    choices: content === undefined ? [] : [{ delta: { content } }],
    ...extra,
  };
}

function streamOf(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const item of chunks) yield item;
    },
  };
}

function router(
  create: (body: Record<string, unknown>, options: Record<string, unknown>) => unknown,
  timeoutMs?: number,
) {
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return new OpenRouterCoachProvider({
    apiKey: 'not-used-by-test',
    model: 'deepseek/deepseek-v4.1-flash-1017',
    structuredOutput: true,
    client,
    ...(timeoutMs ? { timeoutMs } : {}),
  });
}

describe('OpenRouter coach provider streaming (29.10)', () => {
  it('streams the message text and returns the same validated turn', async () => {
    const json = JSON.stringify(validOutput);
    const calls: Array<Record<string, unknown>> = [];
    const provider = router(async (body) => {
      calls.push(body);
      return streamOf([
        chunk(json.slice(0, 20)),
        chunk(json.slice(20, 34)),
        chunk(json.slice(34)),
        chunk(undefined, {
          usage: { prompt_tokens: 50, completion_tokens: 40, total_tokens: 90, cost: 0.0012 },
        }),
      ]);
    });
    const seen: string[] = [];

    const output = await provider.createTurn(personalInput, 'idempotency-stream', {
      onMessageText: (text) => seen.push(text),
    });

    expect(output.result).toEqual(validOutput);
    expect(output.model).toBe('deepseek/deepseek-v4.1-flash-1017');
    expect(output.responseId).toBe('gen-1');
    expect(output.usage).toMatchObject({ inputTokens: 50, outputTokens: 40, costUsd: 0.0012 });
    expect(seen.at(-1)).toBe(validOutput.message);
    expect(seen.length).toBeGreaterThan(1);
    expect(calls[0]).toMatchObject({
      stream: true,
      stream_options: { include_usage: true },
      provider: { data_collection: 'deny' },
    });
  });

  it('does not stream without a listener', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const provider = router(async (body) => {
      calls.push(body);
      return {
        id: 'gen-2',
        model: 'deepseek/deepseek-v4.1-flash-1017',
        choices: [{ message: { content: JSON.stringify(validOutput) } }],
      };
    });

    await provider.createTurn(personalInput, 'idempotency-plain');

    expect(calls[0]).not.toHaveProperty('stream');
  });

  it('times out a stream that stalls after the headers', async () => {
    const provider = router(async (_body, options) => {
      const signal = options.signal as AbortSignal;
      return {
        async *[Symbol.asyncIterator]() {
          yield chunk('{"message":"Нач');
          await new Promise((_, reject) =>
            signal.addEventListener('abort', () => reject(new Error('aborted'))),
          );
        },
      };
    }, 30);

    await expect(
      provider.createTurn(personalInput, 'idempotency-stall', { onMessageText: () => undefined }),
    ).rejects.toMatchObject({ code: 'provider_timeout' });
  });

  it('times out a stream the SDK ends quietly on abort, mid-body', async () => {
    const provider = router(async (_body, options) => {
      const signal = options.signal as AbortSignal;
      return {
        async *[Symbol.asyncIterator]() {
          yield chunk('{"message":"Нач');
          // openai@7 returns from the iterator on abort instead of throwing.
          await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
        },
      };
    }, 30);

    await expect(
      provider.createTurn(personalInput, 'idempotency-quiet', { onMessageText: () => undefined }),
    ).rejects.toMatchObject({ code: 'provider_timeout' });
  });

  it('rejects a streamed answer that breaks the schema', async () => {
    const provider = router(async () => streamOf([chunk('{"message":"Обрыв')]));

    await expect(
      provider.createTurn(personalInput, 'idempotency-cut', { onMessageText: () => undefined }),
    ).rejects.toMatchObject({ code: 'provider_output_invalid' });
  });
});
