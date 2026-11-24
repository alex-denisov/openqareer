import type { SystemDesignTask } from '../domain/systemDesignTask';
import {
  parseSystemDesignTask,
  SYSTEM_DESIGN_TASK_JSON_SCHEMA,
  systemDesignTaskInstructions,
  systemDesignTaskUserMessage,
  type SystemDesignModelInput,
} from '../domain/systemDesignTaskModel';
import { MODEL_CHAINS, resolveChain, type ResolvedChainStage } from './modelChains';
import type { ProviderId } from './modelRegistry';
import { requestChatJson } from './openRouterJson';

/**
 * B750: задача System Design от модели. Дешёвые chat-модели, Vertex не участвует; вход —
 * публичный текст вакансии без данных кандидата. Ответ ступени проверяет домен: не прошёл —
 * следующая ступень; ни одна не дала годной задачи — `null`, и маршрут берёт шаблон.
 */
const ANSWER_TOKENS = 900;
const STAGE_TIMEOUT_MS = 15_000;

export interface SystemDesignTaskWriter {
  write(input: SystemDesignModelInput): Promise<SystemDesignTask | null>;
}

type OnFailure = (label: string, error: unknown) => void;

interface Stage {
  readonly label: string;
  readonly ask: (user: string) => Promise<unknown>;
}

function stageOf(stage: ResolvedChainStage, fetchImpl: typeof fetch): Stage | null {
  if (stage.kind !== 'route') return null;
  const { route } = stage;
  const system = `${systemDesignTaskInstructions()}\nОтвет — один JSON-объект по схеме: ${JSON.stringify(SYSTEM_DESIGN_TASK_JSON_SCHEMA)}`;
  return {
    label: stage.label,
    ask: (user) =>
      requestChatJson(
        route,
        { system, user, maxTokens: ANSWER_TOKENS, timeoutMs: STAGE_TIMEOUT_MS },
        fetchImpl,
      ),
  };
}

class ChainTaskWriter implements SystemDesignTaskWriter {
  constructor(
    private readonly stages: readonly Stage[],
    private readonly onFailure: OnFailure,
  ) {}

  async write(input: SystemDesignModelInput): Promise<SystemDesignTask | null> {
    const user = systemDesignTaskUserMessage(input);
    for (const stage of this.stages) {
      try {
        const task = parseSystemDesignTask(await stage.ask(user), input);
        if (task) return task;
        this.onFailure(stage.label, new Error('invalid_answer'));
      } catch (error) {
        this.onFailure(stage.label, error);
      }
    }
    return null;
  }
}

export function buildSystemDesignTaskWriter(config: {
  readonly providerCredentials?: Partial<Record<ProviderId, string>>;
  readonly fetchImpl?: typeof fetch;
  readonly onStageFailure?: OnFailure;
}): SystemDesignTaskWriter | undefined {
  // Глобальный fetch берётся на каждом вызове, а не при сборке приложения.
  const fetchImpl: typeof fetch = config.fetchImpl ?? ((...args) => fetch(...args));
  const stages = resolveChain(
    MODEL_CHAINS.systemDesignTasks,
    config.providerCredentials ?? {},
    undefined,
  ).flatMap((stage) => stageOf(stage, fetchImpl) ?? []);
  if (stages.length === 0) return undefined;
  return new ChainTaskWriter(
    stages,
    config.onStageFailure ??
      ((label, error) =>
        console.warn(
          `system-design-task stage-failed stage=${label} ${error instanceof Error ? error.message : 'unknown'}`,
        )),
  );
}
