import type { CoachProvider } from './coachProvider';
import {
  allowedModels,
  modelRegistry,
  type ProviderId,
} from './modelRegistry';
import { NativeCoachProvider } from './nativeCoachProvider';
import {
  OpenAICoachProvider,
  type OpenAICoachModel,
} from './openAICoachProvider';
import {
  isOpenAICompatibleProvider,
  OpenAICompatibleCoachProvider,
} from './openAICompatibleCoachProvider';
import { OpenRouterCoachProvider } from './openRouterCoachProvider';
import {
  cloudflareGatewayHeaders,
  geminiGatewayBaseUrl,
  type CloudflareGatewayConfig,
} from './cloudflareAiGateway';

export interface CoachProviderFactoryOptions {
  provider: ProviderId;
  apiKey: string;
  model?: string;
  folderId?: string;
  /** Тоннель Cloudflare: без него Gemini не строится вовсе (B183). */
  cloudflareGateway?: CloudflareGatewayConfig;
}

/**
 * Решение владельца 2026-09-02: Gemini ходит только через тоннель Cloudflare.
 * Прямой вызов с прод-хоста до 3.7-flash не доходит вовсе, поэтому «без
 * тоннеля пойдём напрямую» — это молчаливый отказ в проде.
 */
function buildGeminiProvider(
  options: CoachProviderFactoryOptions,
  model: string,
  thinkingLevel: 'low' | 'high' | undefined,
): CoachProvider {
  if (!options.cloudflareGateway) {
    throw new Error('gemini requires a configured Cloudflare AI Gateway');
  }
  return new NativeCoachProvider({
    provider: 'gemini',
    apiKey: options.apiKey,
    baseUrl: geminiGatewayBaseUrl(options.cloudflareGateway),
    model,
    extraHeaders: cloudflareGatewayHeaders(options.cloudflareGateway),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  });
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
    // Реестр уже проверил, что модель разрешена; отдельный список из одной
    // строки здесь запрещал владельцу сменить модель без правки кода (B183).
    return new OpenAICoachProvider({
      apiKey: options.apiKey,
      model: model as OpenAICoachModel,
    });
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
  if (options.provider === 'gemini') {
    return buildGeminiProvider(options, model, modelDefinition.thinkingLevel);
  }
  return new NativeCoachProvider({
    provider: options.provider,
    apiKey: options.apiKey,
    baseUrl: definition.baseUrl,
    model,
    folderId: options.folderId,
  });
}
