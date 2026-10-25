import type { CoachTurnInput } from '../domain/coach';
import type { CoachProviderResult } from '../providers/coachProvider';

type MemoryCandidate = CoachProviderResult['result']['memoryCandidates'][number];

/** Grouped digits («600 000», «1 650») read as one number; a comma decimal reads as a dot. */
function numbersIn(text: string): string[] {
  const joined = text.replace(/(\d)[\s\u00a0\u202f](?=\d{3}(?!\d))/gu, '$1');
  return (joined.match(/\d+(?:[.,]\d+)?/gu) ?? []).map((value) => value.replace(',', '.'));
}

/** Text the model may cite: the candidate's own messages and their profile, never an assistant reply. */
function citableSources(input: CoachTurnInput): Map<string, string> {
  const sources = new Map<string, string>();
  for (const message of input.messages) {
    if (message.role === 'user') sources.set(message.id, message.content);
  }
  const knowledge = input.knowledgeContext;
  for (const fact of knowledge?.confirmedFacts ?? []) sources.set(fact.ref, fact.statement);
  for (const document of knowledge?.documents ?? []) sources.set(document.ref, document.excerpt);
  for (const question of knowledge?.openQuestions ?? [])
    sources.set(question.ref, question.statement);
  return sources;
}

function statementKey(statement: string): string {
  return statement
    .toLocaleLowerCase('ru-RU')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * A coach memory proposal reaches the profile only with a candidate-owned source, and every
 * number in it must be one the cited source actually holds: «продали за $50 млн» from a
 * candidate who said he does not know the price is dropped, not stored as his fact.
 */
export function faithfulMemoryCandidates(
  input: CoachTurnInput,
  candidates: readonly MemoryCandidate[],
): MemoryCandidate[] {
  const sources = citableSources(input);
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const refs = candidate.sourceMessageIds;
    if (refs.length === 0 || !refs.every((ref) => sources.has(ref))) return false;
    const cited = new Set(refs.flatMap((ref) => numbersIn(sources.get(ref) ?? '')));
    if (!numbersIn(candidate.statement).every((value) => cited.has(value))) return false;
    const key = statementKey(candidate.statement);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
