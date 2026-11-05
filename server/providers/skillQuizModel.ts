import {
  GENERATED_QUIZ_QUESTION_COUNT,
  parseGeneratedQuestions,
  type GeneratedQuestion,
  type SkillQuizLevel,
} from '../domain/generatedSkillQuiz';
import { chainRoutes, MODEL_CHAINS } from './modelChains';
import type { ProviderId } from './modelRegistry';
import { requestChatJson } from './openRouterJson';
import type { ProviderRoute } from './providerQueue';

/**
 * Вопросы квиза по навыку профиля (блок A, пакет 3). В запросе только
 * название навыка и уровень — данных кандидата модель не получает.
 */
export interface SkillQuizModel {
  generate(input: { skill: string; level: SkillQuizLevel }): Promise<GeneratedQuestion[]>;
}

const SYSTEM_PROMPT = `
Ты составляешь проверочный тест по профессиональному навыку для кандидата любой профессии.
Составь ровно ${GENERATED_QUIZ_QUESTION_COUNT} вопросов на русском языке по навыку и уровню из запроса.
- Большинство вопросов ситуационные: «что произойдёт», «что выберете и почему», а не определения.
- У каждого вопроса ровно 4 разных варианта ответа и только один верный.
- Верный вариант однозначен и проверяем по общепринятой практике; не опирайся на мнения.
- Не делай верным самый длинный вариант и чередуй его место.
- explanation — одно-два предложения, почему верный ответ верный.
Ответ — JSON-объект {"questions":[{"question","options":[4 строки],"correctOptionIndex":0-3,"explanation"}]}.
`;

const STAGE_TIMEOUT_MS = 45_000;
const ANSWER_TOKENS = 6_000;

export class ChatSkillQuizModel implements SkillQuizModel {
  constructor(
    private readonly route: ProviderRoute,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get label(): string {
    return `${this.route.provider}:${this.route.model}`;
  }

  async generate(input: { skill: string; level: SkillQuizLevel }): Promise<GeneratedQuestion[]> {
    const answer = await requestChatJson(
      this.route,
      {
        system: SYSTEM_PROMPT,
        user: JSON.stringify({ skill: input.skill, level: input.level }),
        maxTokens: ANSWER_TOKENS,
        timeoutMs: STAGE_TIMEOUT_MS,
      },
      this.fetchImpl,
    );
    const questions = parseGeneratedQuestions(answer);
    if (!questions) throw new Error(`skill quiz stage ${this.route.model} returned no valid quiz`);
    return questions;
  }
}

/** Запись журнала: какая ступень ответила и за сколько. Данных кандидата и навыка в ней нет. */
export interface SkillQuizStageEvent {
  readonly stage: string;
  readonly outcome: 'answered' | 'failed';
  readonly elapsedMs: number;
  readonly reason?: string;
}

/** Сбой или негодный ответ ступени ведёт к следующей. */
export class QueuedSkillQuizModel implements SkillQuizModel {
  constructor(
    private readonly stages: ReadonlyArray<SkillQuizModel & { readonly label?: string }>,
    private readonly onStage?: (event: SkillQuizStageEvent) => void,
  ) {}

  async generate(input: { skill: string; level: SkillQuizLevel }): Promise<GeneratedQuestion[]> {
    let lastError: unknown = new Error('skill quiz chain is empty');
    for (const stage of this.stages) {
      const startedAt = Date.now();
      const report = (outcome: SkillQuizStageEvent['outcome'], reason?: string) =>
        this.onStage?.({
          stage: stage.label ?? 'unknown',
          outcome,
          elapsedMs: Date.now() - startedAt,
          ...(reason ? { reason } : {}),
        });
      try {
        const questions = await stage.generate(input);
        report('answered');
        return questions;
      } catch (error) {
        report('failed', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
        lastError = error;
      }
    }
    throw lastError;
  }
}

/** Цепочка квиза: ступени chat-completions с ключом. Vertex убран 05.11: 13,1 с против 6,0 с у DeepSeek. */
export function buildSkillQuizModel(config: {
  providerCredentials?: Partial<Record<ProviderId, string>>;
  onStage?: (event: SkillQuizStageEvent) => void;
}): SkillQuizModel | undefined {
  const stages = chainRoutes(MODEL_CHAINS.skillQuizzes, config.providerCredentials ?? {}).map(
    (route) => new ChatSkillQuizModel(route),
  );
  return stages.length > 0 ? new QueuedSkillQuizModel(stages, config.onStage) : undefined;
}
