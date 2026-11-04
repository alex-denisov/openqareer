import {
  GENERATED_QUIZ_QUESTION_COUNT,
  parseGeneratedQuestions,
  type GeneratedQuestion,
  type SkillQuizLevel,
} from '../domain/generatedSkillQuiz';
import { MODEL_CHAINS, resolveChain } from './modelChains';
import type { ProviderId } from './modelRegistry';
import { requestChatJson } from './openRouterJson';
import type { ProviderRoute } from './providerQueue';
import type { VertexConfig } from './vertexAi';
import { VertexJsonClient } from './vertexJson';

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

/** Ступень квиза на Gemini Vertex (04.11): тот же промпт и проверка ответа, транспорт через учёт. */
export class VertexSkillQuizModel implements SkillQuizModel {
  private readonly client: VertexJsonClient;

  constructor(vertex: VertexConfig, fetchImpl: typeof fetch) {
    this.client = new VertexJsonClient(vertex, fetchImpl);
  }

  async generate(input: { skill: string; level: SkillQuizLevel }): Promise<GeneratedQuestion[]> {
    const text = await this.client.complete({
      system: SYSTEM_PROMPT,
      user: JSON.stringify({ skill: input.skill, level: input.level }),
      answerTokens: ANSWER_TOKENS,
    });
    let answer: unknown;
    try {
      answer = JSON.parse(text);
    } catch {
      throw new Error('skill quiz stage vertex returned no JSON');
    }
    const questions = parseGeneratedQuestions(answer);
    if (!questions) throw new Error('skill quiz stage vertex returned no valid quiz');
    return questions;
  }
}

/** Сбой или негодный ответ ступени ведёт к следующей. */
export class QueuedSkillQuizModel implements SkillQuizModel {
  constructor(private readonly stages: readonly SkillQuizModel[]) {}

  async generate(input: { skill: string; level: SkillQuizLevel }): Promise<GeneratedQuestion[]> {
    let lastError: unknown = new Error('skill quiz chain is empty');
    for (const stage of this.stages) {
      try {
        return await stage.generate(input);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}

/** Цепочка квиза: Vertex первым (когда настроен), затем ступени chat-completions с ключом. */
export function buildSkillQuizModel(config: {
  providerCredentials?: Partial<Record<ProviderId, string>>;
  vertex?: VertexConfig;
  /** Учётный `fetch` механики `skillQuizzes`; без него ступень Vertex не строится. */
  vertexFetch?: typeof fetch;
}): SkillQuizModel | undefined {
  const stages = resolveChain(
    MODEL_CHAINS.skillQuizzes,
    config.providerCredentials ?? {},
    config.vertexFetch ? config.vertex : undefined,
  ).flatMap((stage): SkillQuizModel[] =>
    stage.kind === 'route'
      ? [new ChatSkillQuizModel(stage.route)]
      : [new VertexSkillQuizModel(stage.vertex, config.vertexFetch!)],
  );
  return stages.length > 0 ? new QueuedSkillQuizModel(stages) : undefined;
}
