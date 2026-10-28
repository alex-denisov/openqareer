import type OpenAI from 'openai';
import { describe, expect, it } from 'vitest';
import { OpenAICoachProvider } from './openAICoachProvider';
import { OpenAICompatibleCoachProvider } from './openAICompatibleCoachProvider';
import { OpenRouterCoachProvider } from './openRouterCoachProvider';
import { LlmRoleNamer } from './roleNamer';
import { buildCoachProvider } from './coachProviderFactory';
import {
  LAST_PROVIDER_STAGE_TIMEOUT_MS,
  PROVIDER_STAGE_MAX_RETRIES,
  PROVIDER_STAGE_TIMEOUT_MS,
  queueStageTimeoutMs,
} from './stageTimeout';

function clientOf(instance: unknown): OpenAI {
  return (instance as { client: OpenAI }).client;
}

describe('потолок ступени', () => {
  it('покрывает самую медленную здоровую попытку замера и не даёт повторов (B197)', () => {
    expect(PROVIDER_STAGE_TIMEOUT_MS).toBe(50_000);
    expect(PROVIDER_STAGE_MAX_RETRIES).toBe(0);
  });

  it('три роли на ход при потолке остаются внутри таймаута запроса', () => {
    const rolesPerTurn = 3;
    const serverRequestTimeoutMs = 190_000;
    expect(PROVIDER_STAGE_TIMEOUT_MS * rolesPerTurn).toBeLessThan(serverRequestTimeoutMs);
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

describe('потолок последней ступени очереди', () => {
  it('последней ступени даёт больше времени: за ней некому передать ход', () => {
    // 25–27.10: три хода из тринадцати по профилю упали, когда gpt-5.6-luna,
    // последняя ступень, упиралась в общий потолок 50 с.
    expect(queueStageTimeoutMs(0, 5)).toBe(PROVIDER_STAGE_TIMEOUT_MS);
    expect(queueStageTimeoutMs(3, 5)).toBe(PROVIDER_STAGE_TIMEOUT_MS);
    expect(queueStageTimeoutMs(4, 5)).toBe(LAST_PROVIDER_STAGE_TIMEOUT_MS);
    expect(queueStageTimeoutMs(0, 1)).toBe(LAST_PROVIDER_STAGE_TIMEOUT_MS);
    expect(LAST_PROVIDER_STAGE_TIMEOUT_MS).toBeGreaterThan(PROVIDER_STAGE_TIMEOUT_MS);
  });

  it('три роли на последней ступени укладываются в ожидание результата клиентом', () => {
    const clientResultWaitMs = 240_000; // RESULT_WAIT_MS, src/features/coach/coachResultDelivery.ts
    expect(LAST_PROVIDER_STAGE_TIMEOUT_MS * 3).toBeLessThanOrEqual(clientResultWaitMs);
  });

  it('фабрика передаёт потолок ступени клиенту провайдера', () => {
    const stage = buildCoachProvider({
      provider: 'openai',
      apiKey: 'k',
      model: 'gpt-5.6-luna',
      timeoutMs: LAST_PROVIDER_STAGE_TIMEOUT_MS,
    });
    expect(clientOf(stage).timeout).toBe(LAST_PROVIDER_STAGE_TIMEOUT_MS);
  });
});
