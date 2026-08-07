import { describe, expect, it } from 'vitest';
import type { CoachTurnInput } from '../domain/coach';
import {
  NativeCoachProvider,
  type NativeProviderId,
} from './nativeCoachProvider';

const input: CoachTurnInput = {
  candidateReference: 'candidate-test-001',
  dataClass: 'synthetic',
  locale: 'ru-RU',
  phase: 'discovery',
  messages: [{ id: 'message-1', role: 'user', content: 'Проверим опыт.' }],
};

const result = {
  message: 'Уточним результат.',
  phase: 'evidence',
  memoryCandidates: [],
  nextQuestion: 'Что изменилось?',
  completeness: { known: ['Есть опыт'], unknown: ['Результат'] },
  safety: { needsHuman: false, reason: null },
};

function responseFor(provider: NativeProviderId): unknown {
  const text = JSON.stringify(result);
  if (provider === 'anthropic') {
    return {
      id: 'anthropic-response',
      model: 'claude-fable-5',
      content: [{ type: 'text', text }],
      usage: { input_tokens: 11, output_tokens: 22 },
    };
  }
  if (provider === 'gemini') {
    return {
      responseId: 'gemini-response',
      modelVersion: 'gemini-3.5-flash',
      candidates: [{ content: { parts: [{ text }] } }],
      usageMetadata: {
        promptTokenCount: 11,
        candidatesTokenCount: 22,
        totalTokenCount: 33,
      },
    };
  }
  if (provider === 'cohere') {
    return {
      id: 'cohere-response',
      message: { content: [{ type: 'text', text }] },
      usage: { tokens: { input_tokens: 11, output_tokens: 22 } },
    };
  }
  return {
    result: {
      modelVersion: 'yandexgpt-version',
      alternatives: [{ message: { text } }],
      usage: {
        inputTextTokens: '11',
        completionTokens: '22',
        totalTokens: '33',
      },
    },
  };
}

describe('native provider connectors', () => {
  for (const provider of [
    'anthropic',
    'gemini',
    'cohere',
    'yandex',
  ] as const satisfies readonly NativeProviderId[]) {
    it(`normalizes ${provider} output without exposing its key`, async () => {
      const requests: Array<{ url: string; init: RequestInit }> = [];
      const fetchImpl: typeof fetch = async (url, init) => {
        requests.push({ url: String(url), init: init ?? {} });
        return new Response(JSON.stringify(responseFor(provider)), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      };
      const connector = new NativeCoachProvider({
        provider,
        apiKey: 'secret-that-must-not-be-returned',
        baseUrl: 'https://provider.invalid/v1',
        model:
          provider === 'yandex' ? 'yandexgpt/latest' : `${provider}-model`,
        folderId: provider === 'yandex' ? 'folder-test' : undefined,
        fetchImpl,
      });

      const output = await connector.createTurn(input, 'idempotency-key');

      expect(output).toMatchObject({
        provider,
        result,
        usage: { inputTokens: 11, outputTokens: 22, totalTokens: 33 },
      });
      expect(JSON.stringify(output)).not.toContain(
        'secret-that-must-not-be-returned',
      );
      expect(requests).toHaveLength(1);
      expect(requests[0].init.method).toBe('POST');
    });
  }
});
