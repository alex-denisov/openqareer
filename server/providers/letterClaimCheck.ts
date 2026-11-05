import OpenAI from 'openai';
import { z } from 'zod';
import {
  applyLetterFixes,
  claimSentenceNumbers,
  CLAIM_CHECK_INSTRUCTIONS,
  CLAIM_FIX_INSTRUCTIONS,
  sentencesOf,
  type LetterFix,
} from '../domain/letterClaims';
import { profileSection, type CoverLetterWriteInput } from './coverLetterWriter';
import { assertOpenRouterModelForPersonalData, isOpenRouterBaseUrl, openRouterRouting } from './openRouterPrivacy';
import type { ChatCompletionClient } from './roleNamer';

export type LetterClaimResult =
  | { readonly body: string; readonly flagged: number }
  | { readonly detail: string };

export interface LetterClaimCheck {
  settle(body: string, input: CoverLetterWriteInput): Promise<LetterClaimResult>;
}

const issuesSchema = z.object({ issues: z.array(z.object({ n: z.number().int(), kind: z.string(), why: z.string().optional() })) });
const fixesSchema = z.object({ fixes: z.array(z.object({ n: z.number().int(), text: z.string() })) });
type Issue = z.infer<typeof issuesSchema>['issues'][number];

/** Ни рассуждение, ни длинный вывод здесь не нужны: замер 05.11 дал 1,1 с при максимуме 1,7 с. */
const CALL_MS = 5_000;
const CALL_TOKENS = 1_500;
const MIN_SENTENCES = 3;
const UNAVAILABLE = { detail: 'letter_claims:unavailable' } as const;

function jsonOf(content: string | null | undefined): unknown {
  if (!content) return null;
  try {
    return JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
  } catch {
    return null;
  }
}

export interface LetterClaimCheckOptions {
  readonly apiKey: string;
  readonly model: string;
  readonly stage: string;
  readonly baseUrl?: string;
  readonly client?: ChatCompletionClient;
}

/** Письмо → проверка → правка названных предложений → проверка правки → удаление того, что не подтвердилось. */
export class LlmLetterClaimCheck implements LetterClaimCheck {
  private readonly client: ChatCompletionClient;
  private readonly openRouter: boolean;

  constructor(private readonly options: LetterClaimCheckOptions) {
    this.openRouter = isOpenRouterBaseUrl(options.baseUrl);
    this.client = options.client ?? (new OpenAI({
      apiKey: options.apiKey,
      ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
      timeout: CALL_MS,
      maxRetries: 0,
    }) as unknown as ChatCompletionClient);
  }

  async settle(body: string, input: CoverLetterWriteInput): Promise<LetterClaimResult> {
    const profile = profileSection(input).join('\n');
    const employers = (input.career ?? []).flatMap((place) => (place.employer ? [place.employer] : []));
    const sentences = sentencesOf(body);
    const wanted = claimSentenceNumbers(sentences, employers);
    if (wanted.length === 0) return { body, flagged: 0 };
    const issues = await this.check(sentences, wanted, profile);
    if (!issues) return UNAVAILABLE;
    if (issues.length === 0) return { body, flagged: 0 };
    const fixes = await this.fix(sentences, issues, profile);
    if (!fixes) return UNAVAILABLE;
    const fixedBody = applyLetterFixes(body, sentences, fixes);
    const fixedSentences = sentencesOf(fixedBody);
    if (fixedSentences.length < MIN_SENTENCES) return { detail: 'letter_claims:too_short' };
    const changed = new Set(fixes.map((fix) => fix.text.trim()));
    const recheck = fixedSentences.flatMap((sentence, index) => (changed.has(sentence) ? [index + 1] : []));
    if (recheck.length === 0) return { body: fixedBody, flagged: issues.length };
    const left = await this.check(fixedSentences, recheck, profile);
    if (!left) return UNAVAILABLE;
    // Правка опять не подтвердилась: предложение уходит, письмо и его голос остаются.
    const cleaned = applyLetterFixes(fixedBody, fixedSentences, left.map((issue) => ({ n: issue.n, text: '' })));
    if (sentencesOf(cleaned).length < MIN_SENTENCES) return { detail: 'letter_claims:too_short' };
    return { body: cleaned, flagged: issues.length };
  }

  private async check(sentences: readonly string[], wanted: readonly number[], profile: string): Promise<Issue[] | null> {
    const letter = sentences.map((sentence, index) => `${index + 1}. ${sentence}`).join('\n');
    const user = `${profile}\n\nПИСЬМО\n${letter}\n\nПроверь только предложения: ${wanted.join(', ')}.`;
    const parsed = issuesSchema.safeParse(jsonOf(await this.ask(CLAIM_CHECK_INSTRUCTIONS, user)));
    return parsed.success ? parsed.data.issues.filter((issue) => wanted.includes(issue.n)) : null;
  }

  private async fix(sentences: readonly string[], issues: readonly Issue[], profile: string): Promise<LetterFix[] | null> {
    const letter = sentences.map((sentence, index) => `${index + 1}. ${sentence}`).join('\n');
    const named = issues.map((issue) => `${issue.n}: ${issue.kind}${issue.why ? `, ${issue.why}` : ''}`).join('\n');
    const user = `${profile}\n\nПИСЬМО\n${letter}\n\nПРАВИТЬ\n${named}`;
    const parsed = fixesSchema.safeParse(jsonOf(await this.ask(CLAIM_FIX_INSTRUCTIONS, user)));
    return parsed.success ? parsed.data.fixes.filter((fix) => issues.some((issue) => issue.n === fix.n)) : null;
  }

  private async ask(instructions: string, user: string): Promise<string | null> {
    const deadline = AbortSignal.timeout(CALL_MS);
    try {
      if (this.openRouter) assertOpenRouterModelForPersonalData(this.options.model);
      const response = await this.client.chat.completions.create({
        model: this.options.model,
        messages: [{ role: 'system', content: instructions }, { role: 'user', content: user }],
        max_tokens: CALL_TOKENS,
        ...(this.openRouter ? { reasoning: { enabled: false } } : {}),
        ...openRouterRouting({ personal: this.openRouter, requireParameters: false }),
      }, { signal: deadline });
      return response.choices[0]?.message?.content ?? null;
    } catch {
      // Причину отказа хранит общий журнал ступени: здесь важно только, что проверки не было.
      return null;
    }
  }
}
