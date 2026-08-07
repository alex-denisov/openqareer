import type { CoachProvider } from './coachProvider';
import {
  allowedModels,
  modelRegistry,
  type ProviderId,
} from './modelRegistry';
import { NativeCoachProvider } from './nativeCoachProvider';
import { OpenAICoachProvider } from './openAICoachProvider';
import {
  isOpenAICompatibleProvider,
  OpenAICompatibleCoachProvider,
} from './openAICompatibleCoachProvider';
import { OpenRouterCoachProvider } from './openRouterCoachProvider';

export interface CoachProviderFactoryOptions {
  provider: ProviderId;
  apiKey: string;
  model?: string;
  folderId?: string;
}

export function buildCoachProvider(
  options: CoachProviderFactoryOptions,
): CoachProvider {
  const definition = modelRegistry[options.provider];
  const model =
    options.model ?? allowedModels(options.provider)[0]?.id;
  const modelDefinition = definition.models.find((item) => item.id === model);
  if (!model || !modelDefinition || !allowedModels(options.provider).includes(modelDefinition)) {
    throw new Error(`model is not allowed for provider ${options.provider}`);
  }
  if (options.provider === 'openai') {
    if (model !== 'gpt-5.6-sol') {
      throw new Error('unsupported OpenAI coach model');
    }
    return new OpenAICoachProvider({ apiKey: options.apiKey, model });
  }
  if (options.provider === 'openrouter') {
    return new OpenRouterCoachProvider({
      apiKey: options.apiKey,
      model,
    });
  }
  if (isOpenAICompatibleProvider(options.provider)) {
    return new OpenAICompatibleCoachProvider({
      provider: options.provider,
      apiKey: options.apiKey,
      baseUrl: definition.baseUrl,
      model,
      structuredOutput: modelDefinition.structuredOutput,
      reasoningEffort:
        options.provider === 'groq' || options.provider === 'cerebras'
          ? 'high'
          : undefined,
    });
  }
  return new NativeCoachProvider({
    provider: options.provider,
    apiKey: options.apiKey,
    baseUrl: definition.baseUrl,
    model,
    folderId: options.folderId,
  });
}
