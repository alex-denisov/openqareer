import type { CoachProvider } from './coachProvider';
import { allowedModels, type ProviderId } from './modelRegistry';
import type { ProviderRoute } from './providerQueue';
import {
  ResilientCoachProvider,
  type ResilientCoachProviderOptions,
} from './resilientCoachProvider';
import { queueStageTimeoutMs } from './stageTimeout';
import type { VertexConfig } from './vertexAi';

/**
 * Ступень цепочки механики: провайдер с ключом и его модель либо Gemini на
 * Vertex (модель берётся из `OPENQAREER_VERTEX_MODEL`, ключ — сервисный аккаунт).
 */
export type ChainStage =
  { readonly provider: ProviderId; readonly model: string } | { readonly provider: 'vertex' };

const VERTEX = { provider: 'vertex' } as const;
const LUNA = { provider: 'openai', model: 'gpt-5.6-luna' } as const;
const DEEPSEEK_FLASH = { provider: 'openrouter', model: 'deepseek/deepseek-v4.1-flash' } as const;
const DEEPSEEK_V4_FLASH = { provider: 'openrouter', model: 'deepseek/deepseek-v4-flash' } as const;
const DEEPSEEK_1017 = {
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4.1-flash-1017',
} as const;
const GLM_FLASH = { provider: 'openrouter', model: 'z-ai/glm-5.3-flash' } as const;

/**
 * Цепочки моделей по механикам (решение владельца 28.10): у каждой механики
 * несколько ступеней, одна модель без запасной — это отказы. Бесплатных
 * маршрутов нет ни в одной: за две недели они не завершили ни одного хода.
 *
 * Порядок ступеней — по замеру 28.10 на реальных входах хода консультанта:
 * gpt-5.6-luna 4/4, deepseek-v4.1-flash 3/4, glm-5.3-flash 4/4.
 *
 * B580 (решение владельца 29.10): Vertex — последняя ступень везде. Его вызов
 * по каталогу $0,0066 против $0,0002 у deepseek-v4-flash, который с 19.10
 * ведёт фон на проде; бонусный кредит Vertex конечен.
 */
export const MODEL_CHAINS = {
  /**
   * Ход консультанта, его роли, сводка беседы, тренажёр интервью, запас служебных шагов.
   * B580 (решение владельца 29.10): платные тарифы — deepseek-v4.1-flash-1017 с запасной
   * deepseek-v4.1-flash; luna последней — обе первые ступени идут через OpenRouter, и его
   * авария не должна оставить ход без ответа.
   */
  coach: [DEEPSEEK_1017, DEEPSEEK_FLASH, LUNA],
  /** B579: 30 ходов Free в месяц — glm-5.3-flash (замер 28.10: 4/4 хода), запасная deepseek. */
  coachFree: [GLM_FLASH, DEEPSEEK_FLASH],
  /** Разбор резюме: только платные маршруты (решение владельца 28.10). */
  resumeParsing: [LUNA, DEEPSEEK_FLASH, GLM_FLASH],
  /** Требования вакансий, процент соответствия, факты кандидата, служебные шаги. */
  bulk: [DEEPSEEK_V4_FLASH, GLM_FLASH, VERTEX],
  /** Тексты, которые читает человек: дешёвая ступень первой, luna — запас по качеству. */
  roleNames: [DEEPSEEK_FLASH, LUNA, VERTEX],
  coverLetters: [DEEPSEEK_FLASH, LUNA, VERTEX],
  linkedinDrafts: [DEEPSEEK_FLASH, LUNA, VERTEX],
  /**
   * Квиз по навыку профиля (блок A, пакет 3): вопросы читает кандидат, поэтому
   * цепочка консультанта, а не фон. Vertex нет: ступени только chat-completions.
   */
  skillQuizzes: [DEEPSEEK_1017, DEEPSEEK_FLASH, LUNA],
  /** Структурный JSON без текста для человека: как фон. */
  campaignRoles: [DEEPSEEK_V4_FLASH, GLM_FLASH, VERTEX],
  titleParsing: [DEEPSEEK_V4_FLASH, GLM_FLASH, VERTEX],
} as const satisfies Record<string, readonly ChainStage[]>;

export type ModelMechanic = keyof typeof MODEL_CHAINS;

/** `vertex` или `provider:model` — так ступени пишутся в журнал и в отчёт. */
export function chainStageLabel(stage: ChainStage): string {
  return stage.provider === 'vertex' ? 'vertex' : `${stage.provider}:${stage.model}`;
}

/**
 * Маршруты ступеней с ключом, в порядке цепочки. Ступень без ключа или с
 * моделью вне реестра пропускается: хвоста из неназванных провайдеров нет —
 * в цепочку попадает только то, что в ней названо.
 */
export function chainRoutes(
  chain: readonly ChainStage[],
  credentials: Partial<Record<ProviderId, string>>,
): ProviderRoute[] {
  return chain.flatMap((stage) => {
    if (stage.provider === 'vertex') return [];
    const apiKey = credentials[stage.provider];
    const allowed = allowedModels(stage.provider).some((model) => model.id === stage.model);
    return apiKey && allowed ? [{ provider: stage.provider, apiKey, model: stage.model }] : [];
  });
}

/** Ступень, готовая к сборке: Gemini на Vertex или маршрут провайдера с ключом. */
export type ResolvedChainStage =
  | { readonly kind: 'vertex'; readonly vertex: VertexConfig; readonly label: string }
  | { readonly kind: 'route'; readonly route: ProviderRoute; readonly label: string };

/**
 * Ступени цепочки в её порядке. Vertex без сервисного аккаунта и провайдер без
 * ключа пропускаются, остальные сохраняют место.
 */
export function resolveChain(
  chain: readonly ChainStage[],
  credentials: Partial<Record<ProviderId, string>>,
  vertex: VertexConfig | undefined,
): ResolvedChainStage[] {
  return chain.flatMap((stage): ResolvedChainStage[] => {
    if (stage.provider === 'vertex') {
      return vertex ? [{ kind: 'vertex', vertex, label: `vertex:${vertex.model}` }] : [];
    }
    return chainRoutes([stage], credentials).map((route) => ({
      kind: 'route',
      route,
      label: `${route.provider}:${route.model}`,
    }));
  });
}

/**
 * Очередь консультанта по его цепочке: каждая ступень получает свой потолок,
 * последняя — длинный (ей некому уступить ход), отказ ступени ведёт к следующей.
 * Ход Free (`modelTier: 'free'`, B579) идёт по цепочке `coachFree`.
 */
export function buildCoachChainProvider(options: {
  credentials: Partial<Record<ProviderId, string>>;
  buildStage: (route: ProviderRoute, timeoutMs: number) => CoachProvider;
  onAttempts?: ResilientCoachProviderOptions['onAttempts'];
  now?: () => number;
}): CoachProvider {
  const paid = buildChainQueue(MODEL_CHAINS.coach, options);
  // Без ключа OpenRouter у Free нет ступеней: ход идёт по платной цепочке, сервер стартует.
  const free = chainRoutes(MODEL_CHAINS.coachFree, options.credentials).length
    ? buildChainQueue(MODEL_CHAINS.coachFree, options)
    : paid;
  return {
    createTurn: (input, idempotencyKey, turnOptions) =>
      (input.modelTier === 'free' ? free : paid).createTurn(input, idempotencyKey, turnOptions),
  };
}

function buildChainQueue(
  chain: readonly ChainStage[],
  options: Parameters<typeof buildCoachChainProvider>[0],
): ResilientCoachProvider {
  const routes = chainRoutes(chain, options.credentials);
  return new ResilientCoachProvider({
    routes: routes.map((route, index) => ({
      id: route.provider,
      model: route.model,
      provider: options.buildStage(route, queueStageTimeoutMs(index, routes.length)),
    })),
    maxAttempts: chain.length,
    ...(options.onAttempts ? { onAttempts: options.onAttempts } : {}),
    ...(options.now ? { now: options.now } : {}),
  });
}
