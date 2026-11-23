import {
  GOAL_BASELINE_JSON_SCHEMA,
  GOAL_EXAMPLES_JSON_SCHEMA,
  goalBaselineInstructions,
  goalBaselineUserMessage,
  goalExamplesInstructions,
  goalExamplesUserMessage,
  groundBaseline,
  parseGoalExamples,
  type BaselineEntry,
  type GoalBaseline,
  type GoalExample,
} from '../domain/goalHints';
import { MODEL_CHAINS, resolveChain, type ResolvedChainStage } from './modelChains';
import type { ProviderId } from './modelRegistry';
import { requestChatJson } from './openRouterJson';
import { assertOpenRouterModelForPersonalData } from './openRouterPrivacy';

/**
 * B744: подсказки формы цели. Та же цепочка, что у подсказки задачи цели (B743): дешёвые
 * chat-модели, Vertex выключен. Записи дневника — данные кандидата: бесплатные модели не берём.
 * Ответ ступени проверяет домен; не прошёл проверку — следующая ступень.
 */
const ANSWER_TOKENS = 500;
const STAGE_TIMEOUT_MS = 15_000;
/**
 * B768: общий срок примеров d02c — экран ждёт их со строкой «Загружаем примеры». Срок прошёл —
 * «примеров нет», экран показывает общие. Одна ступень, а не вся цепочка: кандидат ждёт не дольше.
 */
export const GOAL_EXAMPLES_DEADLINE_MS = STAGE_TIMEOUT_MS;

export interface GoalHints {
  /** `null` — ни одна ступень не дала трёх годных примеров. */
  examples(role: string): Promise<readonly GoalExample[] | null>;
  /** `null` — значения в записях нет или цитата не нашлась в записи. */
  baseline(indicator: string, entries: readonly BaselineEntry[]): Promise<GoalBaseline | null>;
}

type Ask = (system: string, user: string, schema: object) => Promise<unknown>;
type OnFailure = (label: string, error: unknown) => void;

interface Stage {
  readonly label: string;
  readonly ask: Ask;
}

function stageOf(stage: ResolvedChainStage, fetchImpl: typeof fetch): Stage | null {
  if (stage.kind !== 'route') return null;
  const { route } = stage;
  return {
    label: stage.label,
    ask: async (system, user, schema) => {
      if (route.provider === 'openrouter') assertOpenRouterModelForPersonalData(route.model);
      return requestChatJson(
        route,
        {
          system: `${system}\nОтвет — один JSON-объект по схеме: ${JSON.stringify(schema)}`,
          user,
          maxTokens: ANSWER_TOKENS,
          timeoutMs: STAGE_TIMEOUT_MS,
          personal: true,
        },
        fetchImpl,
      );
    },
  };
}

async function firstAccepted<T>(
  stages: readonly Stage[],
  question: readonly [string, string, object],
  accept: (raw: unknown) => T | null,
  onFailure: OnFailure,
  deadline = Number.POSITIVE_INFINITY,
): Promise<T | null> {
  for (const stage of stages) {
    if (Date.now() >= deadline) return null;
    try {
      const accepted = accept(await stage.ask(...question));
      if (accepted !== null) return accepted;
      onFailure(stage.label, new Error('invalid_answer'));
    } catch (error) {
      onFailure(stage.label, error);
    }
  }
  return null;
}

/** Ответ работы или `null`, когда срок вышел раньше. */
function withDeadline<T>(work: Promise<T | null>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

class ChainGoalHints implements GoalHints {
  constructor(
    private readonly stages: readonly Stage[],
    private readonly onFailure: OnFailure,
  ) {}

  examples(role: string) {
    const question = [
      goalExamplesInstructions(),
      goalExamplesUserMessage(role),
      GOAL_EXAMPLES_JSON_SCHEMA,
    ] as const;
    const deadline = Date.now() + GOAL_EXAMPLES_DEADLINE_MS;
    return withDeadline(
      firstAccepted(this.stages, question, parseGoalExamples, this.onFailure, deadline),
      GOAL_EXAMPLES_DEADLINE_MS,
    );
  }

  baseline(indicator: string, entries: readonly BaselineEntry[]) {
    const question = [
      goalBaselineInstructions(),
      goalBaselineUserMessage(indicator, entries),
      GOAL_BASELINE_JSON_SCHEMA,
    ] as const;
    return firstAccepted(
      this.stages,
      question,
      (raw) => groundBaseline(raw, entries),
      this.onFailure,
    );
  }
}

export function buildGoalHints(config: {
  readonly providerCredentials?: Partial<Record<ProviderId, string>>;
  readonly fetchImpl?: typeof fetch;
  readonly onStageFailure?: OnFailure;
}): GoalHints | undefined {
  const fetchImpl = config.fetchImpl ?? fetch;
  const stages = resolveChain(
    MODEL_CHAINS.goalTaskSuggestions,
    config.providerCredentials ?? {},
    undefined,
  ).flatMap((stage) => stageOf(stage, fetchImpl) ?? []);
  if (stages.length === 0) return undefined;
  return new ChainGoalHints(
    stages,
    config.onStageFailure ??
      ((label, error) =>
        console.warn(
          `goal-hints stage-failed stage=${label} ${error instanceof Error ? error.message : 'unknown'}`,
        )),
  );
}
