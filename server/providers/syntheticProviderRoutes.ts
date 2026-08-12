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

export function selectSyntheticProviderRoutes(input: {
  selectedProvider: ProviderId;
  selectedModel?: string;
  credentials: Partial<Record<ProviderId, string>>;
}): SyntheticProviderRoute[] {
  const orderedProviders = [
    input.selectedProvider,
    ...PROVIDER_IDS.filter((provider) => provider !== input.selectedProvider),
  ];

  return orderedProviders.flatMap((provider) => {
    const apiKey = input.credentials[provider];
    const eligibleModels = allowedModels(provider);
    const model =
      provider === input.selectedProvider && input.selectedModel
        ? input.selectedModel
        : eligibleModels[0]?.id;
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
