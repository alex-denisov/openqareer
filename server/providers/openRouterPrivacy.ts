/**
 * Owner 28.10: candidate data may go to OpenRouter (B082 lifted) only if it is
 * never stored or trained on. Every request with such data asks providers to
 * deny data collection; free models and pools, whose endpoints may train on
 * prompts, never receive it. A live check from prod (28.10): the paid chain
 * models answer 200 with `data_collection: 'deny'`, a `:free` model gets 404
 * «No endpoints found matching your data policy».
 */
const FREE_POOLS = new Set(['openrouter/free', 'openrouter/auto']);

export function isFreeOpenRouterModel(model: string): boolean {
  return model.endsWith(':free') || FREE_POOLS.has(model);
}

export class PersonalDataOnFreeModelError extends Error {
  constructor(model: string) {
    super(`candidate data is never sent to the free OpenRouter model ${model}`);
    this.name = 'PersonalDataOnFreeModelError';
  }
}

export function assertOpenRouterModelForPersonalData(model: string): void {
  if (isFreeOpenRouterModel(model)) throw new PersonalDataOnFreeModelError(model);
}

/** The `provider` block of an OpenRouter request; empty when nothing needs saying. */
export function openRouterRouting(input: {
  readonly personal: boolean;
  readonly requireParameters?: boolean;
}): { provider?: { data_collection?: 'deny'; require_parameters?: true } } {
  const provider = {
    ...(input.personal ? { data_collection: 'deny' as const } : {}),
    ...(input.requireParameters ? { require_parameters: true as const } : {}),
  };
  return Object.keys(provider).length ? { provider } : {};
}

export function isOpenRouterBaseUrl(baseUrl: string | undefined): boolean {
  return Boolean(baseUrl?.includes('openrouter.ai'));
}
