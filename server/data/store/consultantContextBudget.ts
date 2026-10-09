import type { CoachTurnInput, CoachTurnStage } from '../../domain/coach';

export const CONSULTANT_CONTEXT_TOKEN_LIMIT = 12_000;
export const CONSULTANT_SUMMARY_COUNT_LIMIT = 6;
export const CONSULTANT_FTS_RESULT_LIMIT = 5;
export const CONSULTANT_MESSAGE_SNIPPET_CHAR_LIMIT = 800;

type BaseKnowledgeContext = NonNullable<CoachTurnInput['knowledgeContext']>;
type ConsultantHistoryContext = NonNullable<BaseKnowledgeContext['consultantHistory']>;

export interface ConsultantHistoryContextCandidate {
  readonly summaries: ConsultantHistoryContext['summaries'];
  readonly messageSnippets: ConsultantHistoryContext['messageSnippets'];
}

export function estimateContextTokens(value: unknown): number {
  return Math.ceil(Buffer.byteLength(JSON.stringify(value), 'utf8') / 4);
}

/** Keeps the Evidence Base intact; lower-priority history is cut in the required order. */
export function fitConsultantHistoryContext(
  base: BaseKnowledgeContext,
  history: ConsultantHistoryContextCandidate,
  tokenLimit = CONSULTANT_CONTEXT_TOKEN_LIMIT,
): BaseKnowledgeContext {
  const summaries = [...history.summaries];
  const messageSnippets = [...history.messageSnippets];
  const fits = () =>
    estimateContextTokens({
      ...base,
      consultantHistory: { summaries, messageSnippets },
    }) <= tokenLimit;

  while (!fits() && messageSnippets.length) messageSnippets.pop();
  while (!fits() && summaries.length) summaries.pop();
  if (!summaries.length && !messageSnippets.length) return base;
  return { ...base, consultantHistory: { summaries, messageSnippets } };
}

export function relatedConsultantStages(stage: CoachTurnStage): readonly CoachTurnStage[] {
  const related: Record<CoachTurnStage, readonly CoachTurnStage[]> = {
    today: ['today', 'profile', 'career'],
    profile: ['profile', 'career', 'today'],
    career: ['career', 'profile', 'today', 'vacancies'],
    vacancies: ['vacancies', 'career', 'responses'],
    responses: ['responses', 'vacancies', 'interviews'],
    interviews: ['interviews', 'responses'],
  };
  return related[stage];
}
