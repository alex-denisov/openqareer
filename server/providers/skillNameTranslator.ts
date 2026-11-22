import { chainRoutes, MODEL_CHAINS } from './modelChains';
import type { ProviderId } from './modelRegistry';
import { requestChatJson } from './openRouterJson';
import type { ProviderRoute } from './providerQueue';

/**
 * B734: названия навыков проверки берутся из текста вакансий и бывают английскими
 * («Cross-functional leadership»). Один вызов на старте проверки даёт русские названия;
 * данных кандидата в запросе нет — только названия требований.
 */
export interface SkillNameTranslator {
  translate(names: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

const SYSTEM_PROMPT = `
Ты переводишь названия профессиональных навыков из вакансий на русский — так, как их пишут
в русских вакансиях и резюме. Устоявшиеся термины оставь как есть: Agile, Scrum, SQL, Python,
Kafka, Kubernetes, DevOps, CRM, ERP, KPI, SLA, ITIL и названия продуктов и технологий.
Русское название оставь без изменений. Не добавляй пояснений.
Ответ — JSON-объект {"names":{"<исходное название>":"<русское название>"}} по каждому названию из запроса.
`;

const STAGE_TIMEOUT_MS = 8_000;
const ANSWER_TOKENS = 1_500;
const NAME_MAX_CHARS = 200;

/** Только названия из запроса с непустым переводом; остальное — исходное название. */
export function parseSkillNames(answer: unknown, names: readonly string[]): ReadonlyMap<string, string> {
  const map = (answer as { names?: unknown } | null)?.names;
  if (typeof map !== 'object' || map === null) return new Map();
  const entries = names.flatMap((name) => {
    const value = (map as Record<string, unknown>)[name];
    const text = typeof value === 'string' ? value.trim() : '';
    return text && text.length <= NAME_MAX_CHARS ? [[name, text] as const] : [];
  });
  return new Map(entries);
}

/** Ступени по очереди: сбой одной — следующая; все отказали — исключение, проверка идёт без перевода. */
export class ChatSkillNameTranslator implements SkillNameTranslator {
  constructor(
    private readonly routes: readonly ProviderRoute[],
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async translate(names: readonly string[]): Promise<ReadonlyMap<string, string>> {
    let lastError: unknown = new Error('skill name chain is empty');
    for (const route of this.routes) {
      try {
        const answer = await requestChatJson(
          route,
          { system: SYSTEM_PROMPT, user: JSON.stringify({ names }), maxTokens: ANSWER_TOKENS, timeoutMs: STAGE_TIMEOUT_MS },
          this.fetchImpl,
        );
        return parseSkillNames(answer, names);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

/** Цепочка квиза навыков (DeepSeek, без Vertex): дешёвая и уже под этот род задач. */
export function buildSkillNameTranslator(config: {
  providerCredentials?: Partial<Record<ProviderId, string>>;
}): SkillNameTranslator | undefined {
  const routes = chainRoutes(MODEL_CHAINS.skillQuizzes, config.providerCredentials ?? {});
  return routes.length > 0 ? new ChatSkillNameTranslator(routes) : undefined;
}
