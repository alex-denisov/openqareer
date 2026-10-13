export const MAX_STAR_STORIES_PER_CANDIDATE = 100;

export const STAR_FIELDS = ['situation', 'task', 'action', 'result'] as const;

export type StarField = (typeof STAR_FIELDS)[number];
export type StarStoryConfidence = 'confirmed' | 'unconfirmed';

export interface StarStoryFields {
  readonly situation: string;
  readonly task: string;
  readonly action: string;
  readonly result: string;
}

export interface StarStoryFactSummary {
  readonly id: string;
  readonly statement: string;
}

export interface StarStoryWriteInput {
  readonly title: string;
  readonly fields: StarStoryFields;
  readonly sourceFactIds: readonly string[];
}

export interface StarStoryRecord extends StarStoryWriteInput {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StarStoryFactView extends StarStoryFactSummary {
  readonly domain: string;
  readonly createdAt: string;
  readonly unavailable?: boolean;
}

export interface StarStoryView extends StarStoryRecord {
  readonly confidence: StarStoryConfidence;
  readonly sourceFacts: readonly StarStoryFactView[];
}

export interface StarStoriesSnapshot {
  readonly stories: readonly StarStoryView[];
  readonly facts: readonly StarStoryFactView[];
}

export function starStoryEvidenceStatus(
  result: string,
  sourceFactIds: readonly string[],
  sourceFacts: readonly StarStoryFactSummary[],
): StarStoryConfidence {
  const factIds = new Set(sourceFactIds);
  if (factIds.size === 0) return 'unconfirmed';
  const linkedFacts = sourceFacts.filter((fact) => factIds.has(fact.id));
  if (linkedFacts.length !== factIds.size) return 'unconfirmed';
  return missingStarResultNumbers(result, linkedFacts).length === 0 ? 'confirmed' : 'unconfirmed';
}

export function missingStarResultNumbers(
  result: string,
  sourceFacts: readonly StarStoryFactSummary[],
): readonly string[] {
  const sourceNumbers = new Set(sourceFacts.flatMap((fact) => numericValues(fact.statement)));
  return numericValues(result).filter((value) => !sourceNumbers.has(value));
}

export function starResultHasNumbers(result: string): boolean {
  return numericValues(result).length > 0;
}

function numericValues(value: string): readonly string[] {
  return (value.match(/\d+(?:[.,]\d+)?/gu) ?? []).map((number) =>
    Number(number.replace(',', '.')).toString(),
  );
}
