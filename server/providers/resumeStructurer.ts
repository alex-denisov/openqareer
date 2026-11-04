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
import { mergeResumeFragments, RESUME_CONTINUED_TITLE, splitResumeIntoFragments } from './resumeFragments';
import { chainRoutes, MODEL_CHAINS } from './modelChains';
import { assertOpenRouterModelForPersonalData, isOpenRouterBaseUrl, openRouterRouting } from './openRouterPrivacy';

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
  /** Extra rules after the shared prompt; a fragment of a long resume needs them. */
  extraInstructions?: string;
}

/**
 * One narrow call: resume text in, validated JSON out. It deliberately does not
 * reuse `CoachProvider` — that contract carries conversation phases, memory
 * candidates and career actions, none of which belong to reading a document.
 */
export class LlmResumeStructurer implements ResumeStructurer {
  private readonly openRouter: boolean;
  private readonly client: ChatCompletionClient;
  private readonly model: string;
  private readonly structuredOutput: boolean;
  private readonly instructions: string;
  readonly provenance: Readonly<{ model: string; promptRevision: string }>;

  constructor(options: LlmResumeStructurerOptions) {
    this.model = options.model;
    this.provenance = { model: options.model, promptRevision: RESUME_STRUCTURING_PROMPT_REVISION };
    this.structuredOutput = options.structuredOutput ?? true;
    this.instructions = options.extraInstructions
      ? `${RESUME_STRUCTURING_INSTRUCTIONS}\n${options.extraInstructions}`
      : RESUME_STRUCTURING_INSTRUCTIONS;
    // A resume is personal data: on OpenRouter it is never collected (28.10).
    this.openRouter = isOpenRouterBaseUrl(options.baseUrl);
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
      if (this.openRouter) assertOpenRouterModelForPersonalData(this.model);
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: this.instructions },
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
        ...openRouterRouting({ personal: this.openRouter }),
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
  providerCredentials?: Partial<Record<ProviderId, string>>;
}

/**
 * Потолок ступени: снаружи весь разбор ограничен `resumeStructuringBudgetMs`,
 * и ступень, занявшая его целиком, не оставила бы запасным ни секунды.
 */
export const RESUME_STAGE_TIMEOUT_MS = 25_000;

/**
 * Ступени цепочки по порядку: молчание или сбой одной ведёт к следующей.
 * Провенанс называет ступень, которая ответила последней.
 */
export class QueuedResumeStructurer implements ResumeStructurer {
  private answered: ResumeStructurer | undefined;

  constructor(readonly stages: readonly ResumeStructurer[]) {}

  get provenance(): ResumeStructurer['provenance'] {
    return (this.answered ?? this.stages[0])?.provenance;
  }

  async structure(sourceText: string): Promise<ParsedResume | null> {
    let partial: { stage: ResumeStructurer; parsed: ParsedResume } | undefined;
    for (const stage of this.stages) {
      const parsed = await stage.structure(sourceText).catch(() => null);
      if (parsed === null) continue;
      if (hasPlaces(parsed)) {
        this.answered = stage;
        return parsed;
      }
      if (!partial && hasContent(parsed)) partial = { stage, parsed };
    }
    // A resume with no places in any answer (a student's) keeps what was read.
    this.answered = partial?.stage;
    return partial?.parsed ?? null;
  }
}

/** A polite answer without places of work fails the stage: the candidate would get a profile with no experience (04.11). */
function hasPlaces(parsed: ParsedResume): boolean {
  return (parsed.experience?.length ?? 0) > 0;
}

function hasContent(parsed: ParsedResume): boolean {
  return (parsed.skills?.length ?? 0) > 0 || (parsed.education?.length ?? 0) > 0;
}

/**
 * Резюме — персональные данные; цепочка разбора только из платных маршрутов
 * (решение владельца 28.10): бесплатный nemotron был её единственной ступенью.
 *
 * Returns `undefined` when no stage has a credential, so a deployment without
 * a provider key keeps working on the deterministic parser alone.
 */
export const RESUME_FRAGMENT_INSTRUCTIONS = `This is one fragment of a longer resume; other fragments are read separately.
- Extract only what this fragment holds; leave everything else null or empty.
- If the fragment ends with a job heading that has no dates and no bullets, leave that job out.
- If the fragment starts with bullets whose job heading is not in it, return them as one experience entry with the title "${RESUME_CONTINUED_TITLE}".`;

/**
 * A long resume read in parallel fragments: answer length sets the wait, and one whole answer on
 * 16 000 characters does not fit the stage ceiling. Each fragment walks the chain on its own. One
 * fragment without an answer fails the whole read, because the rules floor beats a resume with a
 * silent gap in it.
 */
export class FragmentedResumeStructurer implements ResumeStructurer {
  constructor(
    readonly whole: ResumeStructurer,
    private readonly fragment: ResumeStructurer,
  ) {}

  get provenance(): ResumeStructurer['provenance'] {
    return this.lastReader?.provenance ?? this.whole.provenance;
  }

  private lastReader: ResumeStructurer | undefined;

  async structure(sourceText: string): Promise<ParsedResume | null> {
    const fragments = splitResumeIntoFragments(sourceText.slice(0, MAX_SOURCE_CHARACTERS));
    if (fragments.length === 1) {
      this.lastReader = this.whole;
      return this.whole.structure(sourceText);
    }
    const parts = await Promise.all(fragments.map((text) => this.fragment.structure(text)));
    if (parts.some((part) => part === null)) return null;
    this.lastReader = this.fragment;
    return mergeResumeFragments(parts as ParsedResume[], sourceText);
  }
}

/** A fragment may hold only skills or only a contact block; only a fragment with nothing in it is a refusal (#428). */
export class FragmentChainStructurer implements ResumeStructurer {
  private answered: ResumeStructurer | undefined;

  constructor(readonly stages: readonly ResumeStructurer[]) {}

  get provenance(): ResumeStructurer['provenance'] {
    return (this.answered ?? this.stages[0])?.provenance;
  }

  async structure(sourceText: string): Promise<ParsedResume | null> {
    for (const stage of this.stages) {
      const parsed = await stage.structure(sourceText).catch(() => null);
      if (parsed !== null && carriesAnyFact(parsed)) {
        this.answered = stage;
        return parsed;
      }
    }
    return null;
  }
}

function carriesAnyFact(parsed: ParsedResume): boolean {
  return (
    hasPlaces(parsed) ||
    hasContent(parsed) ||
    [parsed.fullName, parsed.targetRole, parsed.about, parsed.contact.email, parsed.contact.phone].some(Boolean) ||
    [parsed.courses, parsed.tests, parsed.recommendations, parsed.languages].some((list) => (list?.length ?? 0) > 0)
  );
}

export function buildResumeStructurer(
  config: ResumeStructurerConfig,
): ResumeStructurer | undefined {
  const routes = chainRoutes(MODEL_CHAINS.resumeParsing, config.providerCredentials ?? {});
  if (routes.length === 0) return undefined;
  // Чистка стоит на самой сборке: разобранное резюме кандидат правит в
  // «Студии» и уносит в отклики, и пути мимо неё быть не должно (B210).
  const stage = (extraInstructions?: string) =>
    routes.map(
      (route) =>
        new LlmResumeStructurer({
          apiKey: route.apiKey,
          model: route.model,
          baseUrl: route.provider === 'openai' ? undefined : modelRegistry[route.provider].baseUrl,
          timeoutMs: RESUME_STAGE_TIMEOUT_MS,
          structuredOutput:
            modelRegistry[route.provider].models.find((item) => item.id === route.model)
              ?.structuredOutput ?? true,
          ...(extraInstructions ? { extraInstructions } : {}),
        }),
    );
  return new HygienicResumeStructurer({
    inner: new FragmentedResumeStructurer(
      new QueuedResumeStructurer(stage()),
      new FragmentChainStructurer(stage(RESUME_FRAGMENT_INSTRUCTIONS)),
    ),
  });
}
