import { COACH_TURN_JSON_SCHEMA, type CoachTurnInput } from './coach';

/**
 * Постоянная часть хода идёт первой и не меняется между ходами одной беседы:
 * DeepSeek на OpenRouter читает совпавший префикс из кэша по цене в 50 раз
 * ниже (B580). Всё, что зависит от реплики, — фаза, найденные прошлые
 * сообщения, срез рынка, сама переписка — стоит в хвосте.
 */
export function serializeCoachInput(input: CoachTurnInput): string {
  const knowledge = input.knowledgeContext ?? {
    confirmedFacts: [],
    documents: [],
    openQuestions: [],
  };
  const history = knowledge.consultantHistory;
  const stableKnowledge = history
    ? { ...knowledge, consultantHistory: { summaries: history.summaries } }
    : knowledge;
  return JSON.stringify({
    task:
      input.internalPurpose === 'consultant-summary'
        ? 'Summarize the closed candidate conversation'
        : input.internalPurpose === 'structured-stage'
          ? 'Do the stageContext task and return its JSON result as message'
          : 'Continue the candidate discovery interview',
    outputContract: COACH_TURN_JSON_SCHEMA,
    dataClass: input.dataClass,
    locale: input.locale,
    activeRole: input.activeRole ?? 'career_consultant',
    ...(input.internalPurpose ? { internalPurpose: input.internalPurpose } : {}),
    ...(input.stageContext ? { stageContext: input.stageContext } : {}),
    ...(input.resumeContext ? { resumeContext: input.resumeContext } : {}),
    ...(input.careerContext ? { careerContext: input.careerContext } : {}),
    knowledgeContext: stableKnowledge,
    phase: input.phase,
    ...(input.rejectedProposals && input.rejectedProposals.length > 0
      ? { rejectedProposals: input.rejectedProposals }
      : {}),
    priorRoleContributions: input.priorRoleContributions ?? [],
    marketObservations: input.marketObservations ?? [],
    ...(history?.messageSnippets.length ? { pastMessageMatches: history.messageSnippets } : {}),
    conversation: input.messages,
  });
}
