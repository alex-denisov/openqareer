import { MODEL_CHAINS } from './modelChains';

/** OpenRouter lane of the bulk chain: a pinned model, its pinned hosts and a price cap. */
export interface BulkOpenRouterLane {
  model: string;
  /** Pinned hosts in order: a price change or a rate limit of one does not stop the work. */
  provider: string;
  quantization: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
}

/**
 * Hosts and price caps of each OpenRouter model of the bulk chain (catalog 28.10). A cap is the
 * catalog list price: a host dearer than it is never chosen. Every host supports disabled
 * reasoning and `max_tokens`, so `require_parameters` keeps the request on them.
 */
export const BULK_LANE_PINS: Readonly<Record<string, Omit<BulkOpenRouterLane, 'model'>>> = {
  'deepseek/deepseek-v4.1-flash': {
    provider: 'deepinfra/fp8,baidu/fp8,morph/fp8',
    quantization: 'fp8',
    inputPerMillionUsd: 0.14,
    outputPerMillionUsd: 0.42,
  },
  'z-ai/glm-5.3-flash': {
    provider: 'streamlake/fp8,gmicloud/fp8,novita/fp8',
    quantization: 'fp8',
    inputPerMillionUsd: 0.15,
    outputPerMillionUsd: 0.5,
  },
};

/** OpenRouter lanes in the order of the bulk chain (`MODEL_CHAINS.bulk`); Vertex is not one of them. */
export function bulkOpenRouterLanes(): BulkOpenRouterLane[] {
  return MODEL_CHAINS.bulk.flatMap((stage) => {
    if (stage.provider !== 'openrouter') return [];
    const pins = BULK_LANE_PINS[stage.model];
    if (!pins) throw new Error(`Bulk lane ${stage.model} has no pinned hosts`);
    return [{ model: stage.model, ...pins }];
  });
}

export interface BulkLlmConfig {
  apiKey: string;
  /** OpenRouter lanes of the chain in order; the model and hosts live in code, not in the env. */
  lanes: readonly BulkOpenRouterLane[];
  /** Cap of one run id (for the worker: one UTC day of that worker, see `workerDayRunId`). */
  runUsd: number;
  /** Cap of the whole channel per UTC day, across every run id. */
  dayUsd: number;
  totalUsd: number;
  perRequestUsd: number;
  batchEnabled: boolean;
}
/**
 * The env holds the switch and the spend caps. The chain (28.10: Vertex → deepseek-v4.1-flash →
 * glm-5.3-flash) is code: `OPENQAREER_BULK_LLM_MODEL`, `_PROVIDER`, `_QUANTIZATION` and the price
 * variables are no longer read.
 */
export function readBulkLlmConfig(env: NodeJS.ProcessEnv = process.env): BulkLlmConfig | null {
  if (env.OPENQAREER_BULK_LLM_ENABLED !== 'true') return null;
  const text = (key: string) => {
    const value = env[key]?.trim();
    if (!value) throw new Error(`Missing bulk configuration: ${key}`);
    return value;
  };
  const number = (key: string) => {
    const value = Number(text(key));
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(`Invalid bulk configuration: ${key}`);
    return value;
  };
  return {
    apiKey: text('OPENQAREER_OPENROUTER_API_KEY'),
    lanes: bulkOpenRouterLanes(),
    runUsd: number('OPENQAREER_BULK_LLM_RUN_USD'),
    dayUsd: number('OPENQAREER_BULK_LLM_DAY_USD'),
    totalUsd: number('OPENQAREER_BULK_LLM_TOTAL_USD'),
    perRequestUsd: number('OPENQAREER_BULK_LLM_REQUEST_USD'),
    batchEnabled: env.OPENQAREER_BULK_LLM_BATCH_ENABLED === 'true',
  };
}
