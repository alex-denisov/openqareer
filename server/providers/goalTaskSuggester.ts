import {
  GOAL_TASK_JSON_SCHEMA,
  goalTaskSuggestionInstructions,
  goalTaskUserMessage,
  parseGoalTaskAnswer,
  type GoalTaskModelAnswer,
  type GoalTaskSuggestionInput,
} from '../domain/goalTaskSuggestion';
import { MODEL_CHAINS, resolveChain, type ResolvedChainStage } from './modelChains';
import type { ProviderId } from './modelRegistry';
import { requestChatJson } from './openRouterJson';
import { assertOpenRouterModelForPersonalData } from './openRouterPrivacy';

/**
 * B743 · 2: подсказка следующей задачи по цели. Цепочка `goalTaskSuggestions`, только
 * chat-completions: Vertex выключен. Данные цели — данные кандидата: бесплатные модели не берём.
 */
export const GOAL_TASK_ANSWER_TOKENS = 600;
const STAGE_TIMEOUT_MS = 20_000;
const CHAT_SCHEMA_LINE = `Ответ — один JSON-объект по схеме: ${JSON.stringify(GOAL_TASK_JSON_SCHEMA)}`;

export interface GoalTaskSuggester {
  /** `null` — ни одна ступень не дала ответа по схеме; ответ с `task: null` — «полезной задачи нет». */
  suggest(input: GoalTaskSuggestionInput): Promise<GoalTaskModelAnswer | null>;
}

type Complete = (system: string, user: string) => Promise<unknown>;

interface Stage {
  readonly label: string;
  readonly complete: Complete;
}

function stageOf(stage: ResolvedChainStage, fetchImpl: typeof fetch): Stage | null {
  if (stage.kind !== 'route') return null;
  const { route } = stage;
  return {
    label: stage.label,
    complete: async (system, user) => {
      if (route.provider === 'openrouter') assertOpenRouterModelForPersonalData(route.model);
      return requestChatJson(
        route,
        {
          system: `${system}\n${CHAT_SCHEMA_LINE}`,
          user,
          maxTokens: GOAL_TASK_ANSWER_TOKENS,
          timeoutMs: STAGE_TIMEOUT_MS,
          personal: true,
        },
        fetchImpl,
      );
    },
  };
}

class ChainGoalTaskSuggester implements GoalTaskSuggester {
  constructor(
    private readonly stages: readonly Stage[],
    private readonly onStageFailure: (label: string, error: unknown) => void,
  ) {}

  async suggest(input: GoalTaskSuggestionInput): Promise<GoalTaskModelAnswer | null> {
    const system = goalTaskSuggestionInstructions(input.today);
    const user = goalTaskUserMessage(input);
    for (const stage of this.stages) {
      try {
        const answer = parseGoalTaskAnswer(await stage.complete(system, user));
        if (answer) return answer;
        this.onStageFailure(stage.label, new Error('invalid_answer'));
      } catch (error) {
        this.onStageFailure(stage.label, error);
      }
    }
    return null;
  }
}

export function buildGoalTaskSuggester(config: {
  readonly providerCredentials?: Partial<Record<ProviderId, string>>;
  readonly fetchImpl?: typeof fetch;
  readonly onStageFailure?: (label: string, error: unknown) => void;
}): GoalTaskSuggester | undefined {
  const fetchImpl = config.fetchImpl ?? fetch;
  const stages = resolveChain(
    MODEL_CHAINS.goalTaskSuggestions,
    config.providerCredentials ?? {},
    undefined,
  ).flatMap((stage) => stageOf(stage, fetchImpl) ?? []);
  if (stages.length === 0) return undefined;
  return new ChainGoalTaskSuggester(
    stages,
    config.onStageFailure ??
      ((label, error) =>
        console.warn(
          `goal-task-suggestion stage-failed stage=${label} ${error instanceof Error ? error.message : 'unknown'}`,
        )),
  );
}
