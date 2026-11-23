import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import {
  acceptJudgement,
  judgeInstructions,
  judgeJsonSchema,
  type JudgeInput,
  type Judgement,
} from '../domain/interviewAnswerJudge';
import type { CoverLetterWriterConfig } from './coverLetterWriter';
import { MODEL_CHAINS, resolveChain } from './modelChains';
import { modelRegistry, type ProviderId } from './modelRegistry';
import {
  assertOpenRouterModelForPersonalData,
  isOpenRouterBaseUrl,
  openRouterRouting,
} from './openRouterPrivacy';
import { openRouterReasoning } from './openRouterReasoning';
import type { ChatCompletionClient } from './roleNamer';
import { PROVIDER_STAGE_MAX_RETRIES, PROVIDER_STAGE_TIMEOUT_MS } from './stageTimeout';

/**
 * B780: критерии ответа тренировки оценивает модель цепочки письма (как разбор интервью, без
 * Vertex). Расход ограничен: один вызов на один текст ответа (кэш), выход до 4 000 токенов без рассуждения,
 * ответ до 4 000 знаков (схема маршрута), 20 с на все ступени, маршруты под часовым лимитом.
 */
export interface InterviewAnswerJudge {
  judge(input: JudgeInput): Promise<Judgement | null>;
}

/** Кандидат ждёт оценку на экране; дольше — оценка правил. */
export const JUDGE_BUDGET_MS = 20_000;
/**
 * Прод 23.11: при 1 200 рассуждение DeepSeek и GLM съедало выход — JSON обрывался или приходил
 * пустым, и решали правила. Рассуждение выключено (`openRouterReasoning`), запас — на четыре вердикта.
 */
const OUTPUT_TOKENS = 4_000;
const CACHED_JUDGEMENTS = 500;
const FAILURE_HOLD_MS = 60_000;

interface LlmOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly client?: ChatCompletionClient;
  readonly baseUrl?: string;
  readonly provider?: ProviderId;
}

export class LlmInterviewAnswerJudge implements InterviewAnswerJudge {
  private readonly client: ChatCompletionClient;
  constructor(private readonly options: LlmOptions) {
    this.client =
      options.client ??
      (new OpenAI({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
        timeout: PROVIDER_STAGE_TIMEOUT_MS,
        maxRetries: PROVIDER_STAGE_MAX_RETRIES,
      }) as unknown as ChatCompletionClient);
  }

  async judge(input: JudgeInput): Promise<Judgement | null> {
    // Ответ кандидата — его рассказ о работе: на OpenRouter только модели без сбора данных.
    const openRouter = isOpenRouterBaseUrl(this.options.baseUrl);
    if (openRouter) assertOpenRouterModelForPersonalData(this.options.model);
    const response = await this.client.chat.completions.create({
      model: this.options.model,
      messages: [
        { role: 'system', content: judgeInstructions(input) },
        {
          role: 'user',
          content: JSON.stringify({ question: input.question, answer: input.answer }),
        },
      ],
      ...(this.options.provider && this.options.provider !== 'openai'
        ? { max_tokens: OUTPUT_TOKENS }
        : { max_completion_tokens: OUTPUT_TOKENS }),
      response_format: { type: 'json_schema', json_schema: judgeJsonSchema(input.type) },
      ...(openRouter ? { reasoning: openRouterReasoning(this.options.model) } : {}),
      ...openRouterRouting({ personal: openRouter }),
    });
    try {
      return acceptJudgement(JSON.parse(response.choices[0]?.message.content ?? ''), input);
    } catch {
      return null;
    }
  }
}

/** Ступени по очереди в общем бюджете; первая принятая оценка выигрывает. */
export class QueuedInterviewAnswerJudge implements InterviewAnswerJudge {
  constructor(
    private readonly stages: readonly InterviewAnswerJudge[],
    private readonly budgetMs = JUDGE_BUDGET_MS,
    private readonly onStageError: (error: unknown) => void = () => undefined,
  ) {}

  async judge(input: JudgeInput): Promise<Judgement | null> {
    const deadline = Date.now() + this.budgetMs;
    for (const stage of this.stages) {
      const left = deadline - Date.now();
      if (left <= 0) return null;
      try {
        const judged = await withDeadline(stage.judge(input), left);
        if (judged) return judged;
      } catch (error) {
        this.onStageError(error);
      }
    }
    return null;
  }
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

/**
 * Разбор i03 считается на каждом чтении: один и тот же ответ не зовёт модель повторно. Ключ —
 * хэш входа; в памяти — принятые причины и цитаты до 200 знаков. Неудачу держим минуту: вызов
 * за бюджетом не отменяется, и чтения подряд не должны копить висящие запросы к упавшей модели.
 */
export class CachedInterviewAnswerJudge implements InterviewAnswerJudge {
  private readonly judged = new Map<string, Promise<Judgement | null>>();
  private readonly failedAt = new Map<string, number>();
  constructor(
    private readonly inner: InterviewAnswerJudge,
    private readonly now: () => number = Date.now,
  ) {}

  judge(input: JudgeInput): Promise<Judgement | null> {
    const key = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const failed = this.failedAt.get(key);
    if (failed !== undefined && this.now() - failed < FAILURE_HOLD_MS) return Promise.resolve(null);
    this.failedAt.delete(key);
    const known = this.judged.get(key);
    if (known) return known;
    const forget = () => {
      this.judged.delete(key);
      this.failedAt.set(key, this.now());
    };
    const work = this.inner.judge(input).then(
      (result) => {
        if (!result) forget();
        return result;
      },
      (error: unknown) => {
        forget();
        throw error;
      },
    );
    for (const entries of [this.judged, this.failedAt] as const) {
      const oldest = entries.size >= CACHED_JUDGEMENTS ? entries.keys().next() : null;
      if (oldest && !oldest.done) entries.delete(oldest.value);
    }
    this.judged.set(key, work);
    return work;
  }
}

/** Цепочка письма (`MODEL_CHAINS.coverLetters`) без Vertex; без ключей — пустая, решают правила. */
export function buildInterviewAnswerJudge(
  config: CoverLetterWriterConfig,
  onStageError?: (error: unknown) => void,
): InterviewAnswerJudge {
  const stages = resolveChain(
    MODEL_CHAINS.coverLetters,
    config.providerCredentials ?? {},
    config.vertex,
  );
  const judges = stages.flatMap((stage): InterviewAnswerJudge[] => {
    if (stage.kind === 'vertex') return [];
    const { route } = stage;
    return [
      new LlmInterviewAnswerJudge({
        apiKey: route.apiKey,
        model: route.model,
        provider: route.provider,
        baseUrl: route.provider === 'openai' ? undefined : modelRegistry[route.provider].baseUrl,
      }),
    ];
  });
  return new CachedInterviewAnswerJudge(
    new QueuedInterviewAnswerJudge(judges, JUDGE_BUDGET_MS, onStageError),
  );
}
