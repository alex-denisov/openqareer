import {
  KPI_MODEL_JSON_SCHEMA,
  kpiImportInstructions,
  parseKpiModelAnswer,
  type KpiModelAnswer,
} from '../domain/kpiImport';
import { MODEL_CHAINS, resolveChain, type ResolvedChainStage } from './modelChains';
import type { ProviderId } from './modelRegistry';
import { requestChatJson } from './openRouterJson';
import { assertOpenRouterModelForPersonalData } from './openRouterPrivacy';
import type { VertexConfig } from './vertexAi';
import { VertexJsonClient } from './vertexJson';

/**
 * B686: KPI из текста, таблицы (как текста) или фото слайда — в строки черновика.
 * Цепочка `kpiImport`: Vertex первым, дальше ступени chat-completions. Фото читает только
 * ступень Vertex: у остальных нет входа для изображения, и они его пропускают.
 * KPI работодателя — данные кандидата: бесплатные модели OpenRouter не берём.
 */
export const KPI_ANSWER_TOKENS = 6_000;
const KPI_STAGE_TIMEOUT_MS = 60_000;

export interface KpiExtractInput {
  readonly text: string;
  readonly image?: { readonly mimeType: string; readonly data: Uint8Array };
  readonly today: string;
}

export interface KpiExtractor {
  /** `null` — ни одна ступень не дала ответа по схеме. */
  extract(input: KpiExtractInput): Promise<KpiModelAnswer | null>;
}

interface Stage {
  readonly label: string;
  readonly vision: boolean;
  complete(system: string, input: KpiExtractInput): Promise<string>;
}

function userMessage(input: KpiExtractInput): string {
  return input.image ? 'KPI на изображении.' : 'KPI:\n<<<\n' + input.text + '\n>>>';
}

function stageOf(
  stage: ResolvedChainStage,
  vertexFetch: typeof fetch | undefined,
  fetchImpl: typeof fetch,
): Stage {
  if (stage.kind === 'vertex') {
    const client = new VertexJsonClient(stage.vertex, vertexFetch!);
    return {
      label: stage.label,
      vision: true,
      complete: (system, input) =>
        client.complete({
          system,
          user: userMessage(input),
          answerTokens: KPI_ANSWER_TOKENS,
          responseSchema: KPI_MODEL_JSON_SCHEMA,
          ...(input.image
            ? {
                images: [
                  {
                    mimeType: input.image.mimeType,
                    data: Buffer.from(input.image.data).toString('base64'),
                  },
                ],
              }
            : {}),
        }),
    };
  }
  const { route } = stage;
  return {
    label: stage.label,
    vision: false,
    complete: async (system, input) => {
      if (route.provider === 'openrouter') assertOpenRouterModelForPersonalData(route.model);
      const answer = await requestChatJson(
        route,
        {
          system,
          user: userMessage(input),
          maxTokens: KPI_ANSWER_TOKENS,
          timeoutMs: KPI_STAGE_TIMEOUT_MS,
          personal: true,
        },
        fetchImpl,
      );
      return JSON.stringify(answer);
    },
  };
}

class ChainKpiExtractor implements KpiExtractor {
  constructor(
    private readonly stages: readonly Stage[],
    private readonly onStageFailure: (label: string, error: unknown) => void,
  ) {}

  async extract(input: KpiExtractInput): Promise<KpiModelAnswer | null> {
    const system = kpiImportInstructions(input.today);
    for (const stage of this.stages) {
      if (input.image && !stage.vision) continue;
      try {
        const answer = parseKpiModelAnswer(await stage.complete(system, input));
        if (answer) return answer;
        this.onStageFailure(stage.label, new Error('invalid_answer'));
      } catch (error) {
        this.onStageFailure(stage.label, error);
      }
    }
    return null;
  }
}

export function buildKpiExtractor(config: {
  readonly providerCredentials?: Partial<Record<ProviderId, string>>;
  readonly vertex?: VertexConfig;
  /** Учётный `fetch` механики `kpiImport`; без него ступени Vertex нет. */
  readonly vertexFetch?: typeof fetch;
  readonly fetchImpl?: typeof fetch;
  readonly onStageFailure?: (label: string, error: unknown) => void;
}): KpiExtractor | undefined {
  const stages = resolveChain(
    MODEL_CHAINS.kpiImport,
    config.providerCredentials ?? {},
    config.vertexFetch ? config.vertex : undefined,
  );
  if (stages.length === 0) return undefined;
  const fetchImpl = config.fetchImpl ?? fetch;
  return new ChainKpiExtractor(
    stages.map((stage) => stageOf(stage, config.vertexFetch, fetchImpl)),
    config.onStageFailure ??
      ((label, error) =>
        console.warn(
          `kpi-import stage-failed stage=${label} ${error instanceof Error ? error.message : 'unknown'}`,
        )),
  );
}
