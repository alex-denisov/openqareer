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
 * Решение владельца 04.11: Vertex Gemini — ПЕРВАЯ ступень, пока идёт стартовый кредит Vertex (сгорает
 * около 09.11); ступени после него прежние (DeepSeek и GLM с повторами). Все вызовы Vertex идут через
 * одни ворота (`vertexCredit.ts`): общий потолок по журналу, дневной предел, срок кредита, отключение
 * на 6 часов при отказе биллинга и охлаждение при обычных сбоях. Закрытые ворота или отказ Vertex —
 * ступень не ответила, работа идёт дальше по цепочке, фон не останавливается (28.10: один вызов Vertex
 * над резервом закрыл фон на часы). Прежде Vertex был последней ступенью (B580, 29.10): его вызов по
 * каталогу $0,0066 против $0,0002 у deepseek-v4-flash; 01.11 за час 1 157 вызовов Gemini на $7,81,
 * пока DeepSeek остывал, а glm всегда отвечал 400. Кредит конечен, поэтому после срока цепочки
 * работают без Vertex.
 *
 * Механики, где кандидат ждёт (`campaignRoles`, `roleNames`, `linkedinDrafts`): после Vertex голова
 * цепочки стоит дважды — вторая попытка дешёвой ступени до дорогих. Очереди этих механик идут по
 * массиву подряд, без отбрасывания повторов; три попытки не берём, кандидат ждёт.
 *
 * Пункты резюме (`experienceBullets`) получили Vertex первым по тому же решению; ступени после него
 * прежние, потолок в `vertexChatTimeouts.ts`.
 * Диалог кандидата с консультантом (`coach`, `coachFree`) идёт без Vertex (решение владельца 04.11),
 * квиз (`skillQuizzes`) тоже (решение владельца 05.11).
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
  /** Разбор резюме: только платные маршруты (решение владельца 28.10). Vertex нет: 04.11 на контрольном резюме терял опыт работы. */
  resumeParsing: [LUNA, DEEPSEEK_FLASH, GLM_FLASH],
  /**
   * Пункты резюме из фактов беседы: текст в профиль кандидата, качество важнее цены,
   * вызов редкий (раз на набор фактов). Замер 29.10 на 65 фактах adenisov.test:
   * luna — 14 чистых пунктов за 36–43 с; glm — 12 пунктов за 63 с, слабее; deepseek
   * v4.1-flash тратит все 16 000 токенов на рассуждение и не отвечает.
   */
  experienceBullets: [VERTEX, LUNA, GLM_FLASH],
  /** Требования вакансий, процент соответствия, факты кандидата, служебные шаги. */
  bulk: [VERTEX, DEEPSEEK_V4_FLASH, GLM_FLASH],
  /** Тексты, которые читает человек: дешёвая ступень первой, luna — запас по качеству. */
  roleNames: [VERTEX, DEEPSEEK_FLASH, DEEPSEEK_FLASH, LUNA],
  /** Решение владельца 05.11, замер живых писем: DeepSeek пишет лучше всех, Gemini быстрая запасная. */
  coverLetters: [DEEPSEEK_FLASH, VERTEX, LUNA],
  /** Узкая сверка письма с профилем и точечная правка: без рассуждения 1 с и $0,0003 (замер 05.11). */
  letterChecks: [DEEPSEEK_FLASH],
  linkedinDrafts: [VERTEX, DEEPSEEK_FLASH, DEEPSEEK_FLASH, LUNA],
  /**
   * Квиз по навыку профиля (блок A, пакет 3): вопросы читает кандидат, поэтому
   * цепочка консультанта, а не фон. Без Vertex (решение владельца 05.11): кандидат ждёт,
   * замер 13,1 с на Vertex против 6,0 с на DeepSeek.
   */
  skillQuizzes: [DEEPSEEK_1017, DEEPSEEK_FLASH, LUNA],
  /** Структурный JSON без текста для человека: как фон. */
  campaignRoles: [VERTEX, DEEPSEEK_V4_FLASH, DEEPSEEK_V4_FLASH, GLM_FLASH],
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
