import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { OpenAICoachProvider } from './openAICoachProvider';
import { OpenAICompatibleCoachProvider } from './openAICompatibleCoachProvider';
import { OpenRouterCoachProvider } from './openRouterCoachProvider';
import { LlmRoleNamer } from './roleNamer';
import {
  PROVIDER_STAGE_MAX_RETRIES,
  PROVIDER_STAGE_TIMEOUT_MS,
} from './stageTimeout';

function clientOf(instance: unknown): OpenAI {
  return (instance as { client: OpenAI }).client;
}

describe('потолок ступени', () => {
  it('владелец назвал тридцать секунд без повторов внутри ступени', () => {
    expect(PROVIDER_STAGE_TIMEOUT_MS).toBe(30_000);
    expect(PROVIDER_STAGE_MAX_RETRIES).toBe(0);
  });

  it('держится на каждой ступени очереди', () => {
    const stages = [
      new OpenAICoachProvider({ apiKey: 'k', model: 'gpt-5.6-luna' }),
      new OpenAICompatibleCoachProvider({
        provider: 'nvidia',
        apiKey: 'k',
        baseUrl: 'https://example.test/v1',
        model: 'm',
        structuredOutput: false,
      }),
      new OpenRouterCoachProvider({ apiKey: 'k', model: 'openrouter/free' }),
      new LlmRoleNamer({ apiKey: 'k', model: 'm' }),
    ];

    for (const stage of stages) {
      expect(clientOf(stage).timeout).toBe(PROVIDER_STAGE_TIMEOUT_MS);
      expect(clientOf(stage).maxRetries).toBe(PROVIDER_STAGE_MAX_RETRIES);
    }
  });
});
