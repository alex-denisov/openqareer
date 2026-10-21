import { describe, expect, it } from 'vitest';
import type { BulkLlmResult } from '../providers/bulkLlmClient';
import { measuredBulkClient } from './measuredBulkClient';
import { emptyVacancyMechanicsStats } from './vacancyMechanicsStats';

const input = { runId: 'r', task: 't', dataClass: 'public' as const, prefix: 'p', input: 'i' };
const ok: BulkLlmResult = {
  content: '{}',
  model: 'deepseek/deepseek-v4-flash',
  provider: 'StreamLake',
  usage: { cost: 0, promptTokens: 1, cachedTokens: 0, completionTokens: 1 },
};

describe('measured bulk client', () => {
  it('records calls, failures, latency, model and distinct providers', async () => {
    const stats = emptyVacancyMechanicsStats();
    let clock = 0;
    let fail = false;
    const client = measuredBulkClient(
      {
        complete: async () => {
          clock += 7000;
          if (fail) throw new Error('Bulk provider status 503');
          return ok;
        },
      },
      () => stats,
      () => clock,
    );
    await client.complete(input);
    await client.complete(input);
    fail = true;
    await expect(client.complete(input)).rejects.toThrow('503');
    expect(stats).toMatchObject({
      llmCalls: 3,
      llmFailed: 1,
      llmMs: 21000,
      lastModel: ok.model,
      providers: ['StreamLake'],
    });
  });
});
