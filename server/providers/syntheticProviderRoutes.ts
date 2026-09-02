import {
  allowedModels,
  PROVIDER_IDS,
  type ProviderId,
} from './modelRegistry';

export interface SyntheticProviderRoute {
  provider: ProviderId;
  apiKey: string;
  model: string;
}

/** Названный владельцем запасной маршрут: провайдер и его модель. */
export interface SyntheticProviderFallback {
  provider: ProviderId;
  model?: string;
}

/**
 * Порядок остальных провайдеров задан реестром, поэтому «второй приоритет»
 * нельзя вывести из него: после Gemini там стоит OpenAI. Названные владельцем
 * запасные маршруты идут сразу за выбранным, остальные — как раньше (B183).
 */
export function selectSyntheticProviderRoutes(input: {
  selectedProvider: ProviderId;
  selectedModel?: string;
  fallbacks?: readonly SyntheticProviderFallback[];
  credentials: Partial<Record<ProviderId, string>>;
}): SyntheticProviderRoute[] {
  const namedFallbacks = (input.fallbacks ?? []).filter(
    (fallback) => fallback.provider !== input.selectedProvider,
  );
  const orderedProviders = [
    input.selectedProvider,
    ...namedFallbacks.map((fallback) => fallback.provider),
    ...PROVIDER_IDS.filter(
      (provider) =>
        provider !== input.selectedProvider &&
        !namedFallbacks.some((fallback) => fallback.provider === provider),
    ),
  ];

  return orderedProviders.flatMap((provider) => {
    const apiKey = input.credentials[provider];
    const eligibleModels = allowedModels(provider);
    const namedModel =
      provider === input.selectedProvider
        ? input.selectedModel
        : namedFallbacks.find((fallback) => fallback.provider === provider)?.model;
    const model = namedModel ?? eligibleModels[0]?.id;
    if (
      !apiKey ||
      !model ||
      !eligibleModels.some((candidate) => candidate.id === model)
    ) {
      return [];
    }
    return [{ provider, apiKey, model }];
  });
}
