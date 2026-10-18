export interface BulkLlmConfig {
  apiKey: string;
  model: string;
  provider: string;
  quantization: string;
  runUsd: number;
  dayUsd: number;
  totalUsd: number;
  perRequestUsd: number;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  batchEnabled: boolean;
}
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
  const config = {
    apiKey: text('OPENQAREER_OPENROUTER_API_KEY'),
    model: text('OPENQAREER_BULK_LLM_MODEL'),
    provider: text('OPENQAREER_BULK_LLM_PROVIDER'),
    quantization: text('OPENQAREER_BULK_LLM_QUANTIZATION'),
    runUsd: number('OPENQAREER_BULK_LLM_RUN_USD'),
    dayUsd: number('OPENQAREER_BULK_LLM_DAY_USD'),
    totalUsd: number('OPENQAREER_BULK_LLM_TOTAL_USD'),
    perRequestUsd: number('OPENQAREER_BULK_LLM_REQUEST_USD'),
    inputPerMillionUsd: number('OPENQAREER_BULK_LLM_INPUT_PER_MILLION_USD'),
    outputPerMillionUsd: number('OPENQAREER_BULK_LLM_OUTPUT_PER_MILLION_USD'),
    batchEnabled: env.OPENQAREER_BULK_LLM_BATCH_ENABLED === 'true',
  };
  if (
    ![
      'deepseek/deepseek-v4-flash',
      'deepseek/deepseek-v4.1-flash',
      'deepseek/deepseek-v4.1-flash-1017',
    ].includes(config.model)
  )
    throw new Error('Bulk model must be pinned and support disabled reasoning');
  if (
    !/^[a-z0-9][a-z0-9./_-]+$/u.test(config.provider) ||
    !['fp4', 'fp8', 'fp16', 'bf16', 'fp32', 'int4', 'int8', 'mxfp4'].includes(config.quantization)
  )
    throw new Error('Invalid pinned provider or quantization');
  return config;
}
