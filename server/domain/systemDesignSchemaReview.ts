/**
 * B647: разбор System Design ссылается на схему. К критериям «архитектура» и
 * «эксплуатация» добавляются id узлов, названных в цитате. Баллы, причины и
 * цитаты разбора B681 не меняются; без схемы разбор остаётся текстовым.
 */
import type { QuotedAnswerEvaluation, QuotedCriterion } from './interviewAnswerReview';
import { mentionedNodeIds, type SystemDesignSchema } from './systemDesignSchema';

const SCHEMA_CRITERIA: ReadonlySet<string> = new Set(['architecture', 'operations']);

export interface SchemaLinkedCriterion extends QuotedCriterion {
  readonly schemaNodeIds?: readonly string[];
}

export interface SchemaLinkedEvaluation extends Omit<QuotedAnswerEvaluation, 'criteria'> {
  readonly criteria: Readonly<Record<string, SchemaLinkedCriterion>>;
}

function linkCriterion(
  criterion: QuotedCriterion,
  nodeIds: ReadonlySet<string>,
): SchemaLinkedCriterion {
  if (!criterion.quote) return criterion;
  const schemaNodeIds = mentionedNodeIds(criterion.quote).filter((id) => nodeIds.has(id));
  return schemaNodeIds.length > 0 ? { ...criterion, schemaNodeIds } : criterion;
}

export function linkReviewToSchema(
  evaluation: QuotedAnswerEvaluation,
  schema: SystemDesignSchema | null,
): SchemaLinkedEvaluation {
  if (!schema) return evaluation;
  const nodeIds = new Set(schema.nodes.map((node) => node.id));
  const criteria = Object.fromEntries(
    Object.entries(evaluation.criteria).map(([name, criterion]) => [
      name,
      SCHEMA_CRITERIA.has(name) ? linkCriterion(criterion, nodeIds) : criterion,
    ]),
  );
  return { ...evaluation, criteria };
}
