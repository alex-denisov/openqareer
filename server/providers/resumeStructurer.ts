import OpenAI from 'openai';
import {
  RESUME_STRUCTURING_INSTRUCTIONS,
  RESUME_STRUCTURING_JSON_SCHEMA,
  RESUME_STRUCTURING_PROMPT_REVISION,
  structuredResumeSchema,
  structuredResumeToParsed,
  type StructuredResume,
} from '../domain/resumeStructuring';
import type { ParsedResume } from '../../src/features/workspace/resumeParser';
import { modelRegistry, type ProviderId } from './modelRegistry';
import { HygienicResumeStructurer } from './hygienicResumeStructurer';

/** Enough for a long two-column CV; longer input is truncated, never guessed. */
const MAX_SOURCE_CHARACTERS = 60_000;

/** The narrow slice of an OpenAI-compatible client this module actually uses. */
export interface ChatCompletionClient {
  readonly chat: {
    readonly completions: {
      create(request: Record<string, unknown>): Promise<{
        choices: Array<{ message: { content?: string | null } }>;
      }>;
    };
  };
}

/**
 * Сколько импорт ждёт модель, прежде чем отдать кандидату разбор правилами.
 *
 * INC-037: на проде 2026-09-07 импорт отвечал 389 секунд и всё равно приходил
 * к правилам — у структуратора 90 секунд на попытку плюс повтор, а у самого
 * импорта потолка не было вовсе. Модель здесь — улучшение, а не условие:
 * правила дают полный разбор сразу, поэтому ждать её дольше бюджета нельзя.
 */
export function resumeStructuringBudgetMs(): number {
  const configured = Number(process.env.OPENQAREER_RESUME_STRUCTURING_BUDGET_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : 45_000;
}

/**
 * Разбор моделью в пределах бюджета. По его истечении возвращает `null` —
 * то же, что и отказ модели, поэтому вызывающему не нужен отдельный случай.
 * Брошенный запрос дорабатывает молча: его ответ уже никому не нужен, но
 * необработанный отказ уронил бы процесс.
 */
export async function structureWithinBudget(
  sourceText: string,
  structurer: ResumeStructurer,
  budgetMs: number = resumeStructuringBudgetMs(),
): Promise<ParsedResume | null> {
  let timer: NodeJS.Timeout | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), Math.max(0, budgetMs));
    timer.unref?.();
  });
  try {
    return await Promise.race([
      structurer.structure(sourceText).catch(() => null),
      budget,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ResumeStructurer {
  /** Returns `null` when the provider could not produce a valid answer. */
  structure(sourceText: string): Promise<ParsedResume | null>;
  /** Optional for test and third-party adapters; production structurers always provide it. */
  readonly provenance?: Readonly<{ model: string; promptRevision: string }>;
}

export interface LlmResumeStructurerOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  timeoutMs?: number;
  structuredOutput?: boolean;
  client?: ChatCompletionClient;
}

/**
 * One narrow call: resume text in, validated JSON out. It deliberately does not
 * reuse `CoachProvider` — that contract carries conversation phases, memory
 * candidates and career actions, none of which belong to reading a document.
 */
export class LlmResumeStructurer implements ResumeStructurer {
  private readonly client: ChatCompletionClient;
  private readonly model: string;
  private readonly structuredOutput: boolean;
  readonly provenance: Readonly<{ model: string; promptRevision: string }>;

  constructor(options: LlmResumeStructurerOptions) {
    this.model = options.model;
    this.provenance = { model: options.model, promptRevision: RESUME_STRUCTURING_PROMPT_REVISION };
    this.structuredOutput = options.structuredOutput ?? true;
    this.client =
      options.client ??
      (new OpenAI({
        apiKey: options.apiKey,
        ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
        timeout: options.timeoutMs ?? 90_000,
        maxRetries: 1,
      }) as unknown as ChatCompletionClient);
  }

  async structure(sourceText: string): Promise<ParsedResume | null> {
    const source = sourceText.slice(0, MAX_SOURCE_CHARACTERS);
    if (source.trim().length < 40) return null;
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: RESUME_STRUCTURING_INSTRUCTIONS },
          {
            role: 'user',
            content: `<resume-document>\n${source}\n</resume-document>`,
          },
        ],
        max_completion_tokens: 16_000,
        ...(this.structuredOutput
          ? {
              response_format: {
                type: 'json_schema' as const,
                json_schema: {
                  name: 'structured_resume',
                  strict: false,
                  schema: RESUME_STRUCTURING_JSON_SCHEMA as unknown as Record<
                    string,
                    unknown
                  >,
                },
              },
            }
          : { response_format: { type: 'json_object' as const } }),
      });
      const content = response.choices[0]?.message.content;
      if (!content) return null;
      const structured = readStructuredResume(content);
      return structured ? structuredResumeToParsed(structured, sourceText) : null;
    } catch {
      // A structuring failure must never block the import: the deterministic
      // parser still runs and the candidate still reaches Resume Studio.
      return null;
    }
  }
}

function readStructuredResume(content: string): StructuredResume | null {
  const json = extractJsonObject(content);
  if (!json) return null;
  let candidate: unknown;
  try {
    candidate = JSON.parse(json);
  } catch {
    return null;
  }
  const result = structuredResumeSchema.safeParse(candidate);
  return result.success ? result.data : null;
}

/** Providers without strict structured output sometimes wrap JSON in prose. */
function extractJsonObject(content: string): string | null {
  const trimmed = content.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(trimmed);
  if (fenced?.[1]?.trim().startsWith('{')) return fenced[1].trim();
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return null;
}

export interface ResumeStructurerConfig {
  personalProvider?: ProviderId;
  model?: string;
  providerCredentials?: Partial<Record<ProviderId, string>>;
}

/**
 * A real resume is personal data, so it is routed to the **personal** provider
 * — the same one `PrivacyAwareCoachProvider` reserves for candidate content —
 * never to the synthetic pool.
 *
 * Returns `undefined` when no credential is configured, so a deployment without
 * a provider key keeps working on the deterministic parser alone.
 */
export function buildResumeStructurer(
  config: ResumeStructurerConfig,
): ResumeStructurer | undefined {
  const provider: ProviderId = config.personalProvider ?? 'openai';
  const apiKey = config.providerCredentials?.[provider];
  if (!apiKey) return undefined;
  const definition = modelRegistry[provider];
  const model = config.model ?? definition.models[0]?.id;
  if (!model) return undefined;
  // Чистка стоит на самой сборке: разобранное резюме кандидат правит в
  // «Студии» и уносит в отклики, и пути мимо неё быть не должно (B210).
  return new HygienicResumeStructurer({
    inner: new LlmResumeStructurer({
      apiKey,
      model,
      baseUrl: provider === 'openai' ? undefined : definition.baseUrl,
      structuredOutput:
        definition.models.find((item) => item.id === model)?.structuredOutput ??
        true,
    }),
  });
}
