export const MODEL_RELEASE_CUTOFF = '2026-06-30' as const;

export const PROVIDER_IDS = [
  'openai',
  'anthropic',
  'fireworks',
  'openrouter',
  'gemini',
  'groq',
  'mistral',
  'cerebras',
  'cohere',
  'yandex',
] as const;

export type ProviderId = (typeof PROVIDER_IDS)[number];
export type ProviderTransport =
  | 'openai-responses'
  | 'openai-compatible-chat'
  | 'anthropic-messages'
  | 'gemini-generate-content'
  | 'cohere-chat'
  | 'yandex-completion';

export interface ModelDefinition {
  id: string;
  releaseDate: `${number}-${number}-${number}` | null;
  pinned: boolean;
  lifecycle: 'production' | 'preview' | 'rolling';
  structuredOutput: boolean;
}

export interface ProviderDefinition {
  id: ProviderId;
  label: string;
  transport: ProviderTransport;
  baseUrl: string;
  credentialEnvironment: readonly string[];
  models: readonly ModelDefinition[];
}

function provider(
  definition: ProviderDefinition,
): ProviderDefinition {
  return definition;
}

export const modelRegistry: Record<ProviderId, ProviderDefinition> = {
  openai: provider({
    id: 'openai',
    label: 'OpenAI',
    transport: 'openai-responses',
    baseUrl: 'https://api.openai.com/v1',
    credentialEnvironment: ['OPENQAREER_OPENAI_API_KEY'],
    models: [
      {
        id: 'gpt-5.6-sol',
        releaseDate: '2026-06-26',
        pinned: true,
        lifecycle: 'preview',
        structuredOutput: true,
      },
    ],
  }),
  anthropic: provider({
    id: 'anthropic',
    label: 'Anthropic',
    transport: 'anthropic-messages',
    baseUrl: 'https://api.anthropic.com/v1',
    credentialEnvironment: ['OPENQAREER_ANTHROPIC_API_KEY'],
    models: [
      {
        id: 'claude-fable-5',
        releaseDate: '2026-06-09',
        pinned: true,
        lifecycle: 'production',
        structuredOutput: false,
      },
    ],
  }),
  fireworks: provider({
    id: 'fireworks',
    label: 'Fireworks AI',
    transport: 'openai-compatible-chat',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    credentialEnvironment: ['OPENQAREER_FIREWORKS_API_KEY'],
    models: [
      {
        id: 'accounts/fireworks/models/glm-5p2',
        releaseDate: '2026-06-16',
        pinned: true,
        lifecycle: 'production',
        structuredOutput: true,
      },
    ],
  }),
  openrouter: provider({
    id: 'openrouter',
    label: 'OpenRouter',
    transport: 'openai-compatible-chat',
    baseUrl: 'https://openrouter.ai/api/v1',
    credentialEnvironment: ['OPENQAREER_OPENROUTER_API_KEY'],
    models: [
      {
        id: 'anthropic/claude-fable-5',
        releaseDate: '2026-06-09',
        pinned: true,
        lifecycle: 'production',
        structuredOutput: false,
      },
      {
        id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        releaseDate: '2026-06-04',
        pinned: true,
        lifecycle: 'preview',
        structuredOutput: false,
      },
    ],
  }),
  gemini: provider({
    id: 'gemini',
    label: 'Google Gemini',
    transport: 'gemini-generate-content',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    credentialEnvironment: ['OPENQAREER_GEMINI_API_KEY'],
    models: [
      {
        id: 'gemini-3.5-flash',
        releaseDate: '2026-05-19',
        pinned: true,
        lifecycle: 'production',
        structuredOutput: true,
      },
    ],
  }),
  groq: provider({
    id: 'groq',
    label: 'Groq',
    transport: 'openai-compatible-chat',
    baseUrl: 'https://api.groq.com/openai/v1',
    credentialEnvironment: ['OPENQAREER_GROQ_API_KEY'],
    models: [
      {
        id: 'openai/gpt-oss-120b',
        releaseDate: '2025-08-05',
        pinned: true,
        lifecycle: 'production',
        structuredOutput: true,
      },
    ],
  }),
  mistral: provider({
    id: 'mistral',
    label: 'Mistral AI',
    transport: 'openai-compatible-chat',
    baseUrl: 'https://api.mistral.ai/v1',
    credentialEnvironment: ['OPENQAREER_MISTRAL_API_KEY'],
    models: [
      {
        id: 'mistral-medium-3-5',
        releaseDate: '2026-04-28',
        pinned: true,
        lifecycle: 'production',
        structuredOutput: true,
      },
    ],
  }),
  cerebras: provider({
    id: 'cerebras',
    label: 'Cerebras',
    transport: 'openai-compatible-chat',
    baseUrl: 'https://api.cerebras.ai/v1',
    credentialEnvironment: ['OPENQAREER_CEREBRAS_API_KEY'],
    models: [
      {
        id: 'zai-glm-4.7',
        releaseDate: '2026-01-06',
        pinned: true,
        lifecycle: 'preview',
        structuredOutput: true,
      },
      {
        id: 'gpt-oss-120b',
        releaseDate: '2025-08-05',
        pinned: true,
        lifecycle: 'production',
        structuredOutput: true,
      },
    ],
  }),
  cohere: provider({
    id: 'cohere',
    label: 'Cohere',
    transport: 'cohere-chat',
    baseUrl: 'https://api.cohere.com',
    credentialEnvironment: ['OPENQAREER_COHERE_API_KEY'],
    models: [
      {
        id: 'command-a-plus-05-2026',
        releaseDate: '2026-05-20',
        pinned: true,
        lifecycle: 'production',
        structuredOutput: false,
      },
    ],
  }),
  yandex: provider({
    id: 'yandex',
    label: 'Yandex AI Studio',
    transport: 'yandex-completion',
    baseUrl: 'https://llm.api.cloud.yandex.net/foundationModels/v1',
    credentialEnvironment: [
      'OPENQAREER_YANDEX_API_KEY',
      'OPENQAREER_YANDEX_FOLDER_ID',
    ],
    models: [
      {
        id: 'yandexgpt/latest',
        releaseDate: null,
        pinned: false,
        lifecycle: 'rolling',
        structuredOutput: false,
      },
    ],
  }),
};

export function isModelAllowed(model: ModelDefinition): boolean {
  return (
    model.pinned &&
    model.releaseDate !== null &&
    model.releaseDate <= MODEL_RELEASE_CUTOFF
  );
}

export function allowedModels(providerId: ProviderId): readonly ModelDefinition[] {
  return modelRegistry[providerId].models.filter(isModelAllowed);
}

export interface ProviderCatalogStatus {
  id: ProviderId;
  label: string;
  configured: boolean;
  eligible: boolean;
  models: readonly string[];
  reason: 'ready' | 'missing-credentials' | 'no-cutoff-safe-model';
}

export function getProviderCatalogStatus(
  environment: NodeJS.ProcessEnv,
): ProviderCatalogStatus[] {
  return PROVIDER_IDS.map((id) => {
    const definition = modelRegistry[id];
    const models = allowedModels(id).map((model) => model.id);
    const configured = definition.credentialEnvironment.every(
      (name) => Boolean(environment[name]?.trim()),
    );
    const eligible = models.length > 0;
    return {
      id,
      label: definition.label,
      configured,
      eligible,
      models,
      reason: !eligible
        ? 'no-cutoff-safe-model'
        : configured
          ? 'ready'
          : 'missing-credentials',
    };
  });
}
