import type { BulkLlmClient, BulkLlmInput, BulkLlmResult } from '../providers/bulkLlmClient';
import type { VacancyMechanicsStats } from './vacancyMechanicsStats';

export type BulkCompletion = Pick<BulkLlmClient, 'complete'>;

/** Counts every model call of the worker for the batch journal line: model, provider, latency, failures. */
export function measuredBulkClient(
  client: BulkCompletion,
  stats: () => VacancyMechanicsStats,
  now: () => number = Date.now,
): BulkCompletion {
  return {
    async complete(input: BulkLlmInput): Promise<BulkLlmResult> {
      const startedAt = now();
      const record = stats();
      record.llmCalls += 1;
      try {
        const result = await client.complete(input);
        record.lastModel = result.model;
        record.providers = record.providers.includes(result.provider)
          ? record.providers
          : [...record.providers, result.provider];
        if (result.fallbackReason) {
          record.fallbackCalls += 1;
          record.fallbackReason = result.fallbackReason;
        }
        return result;
      } catch (error) {
        record.llmFailed += 1;
        throw error;
      } finally {
        record.llmMs += now() - startedAt;
      }
    },
  };
}
