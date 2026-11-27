import { describe, expect, it } from 'vitest';
import { scoreInterviewAnswer } from './interviewSimulator';
import { scoreInterviewAnswerWithQuotes } from './interviewAnswerReview';
import { extractSystemDesignSchema } from './systemDesignSchema';
import { linkReviewToSchema } from './systemDesignSchemaReview';

const ANSWER =
  'Требования: 2000 платежей в секунду и latency до 300 мс. Компоненты: API, очередь и база. ' +
  'Я выбрал очередь, потому что нужна повторная доставка. Метрики и алерты на ошибки.';

describe('B647: разбор ссылается на схему', () => {
  it('adds schema node ids to architecture and operations quotes only', () => {
    const evaluation = scoreInterviewAnswerWithQuotes(ANSWER, 'system_design');
    const schema = extractSystemDesignSchema(ANSWER)!;
    const linked = linkReviewToSchema(evaluation, schema);
    expect(linked.criteria.architecture).toMatchObject({
      quote: 'Компоненты: API, очередь и база.',
      schemaNodeIds: ['gateway', 'queue', 'database'],
    });
    expect(linked.criteria.operations).toMatchObject({
      quote: 'Я выбрал очередь, потому что нужна повторная доставка.',
      schemaNodeIds: ['queue'],
    });
    expect(linked.criteria.requirements).not.toHaveProperty('schemaNodeIds');
    expect(linked.criteria.tradeoffs).not.toHaveProperty('schemaNodeIds');
    expect(linked.points).toBe(evaluation.points);
  });

  it('keeps only nodes left in the corrected schema and leaves text-only review as is', () => {
    const evaluation = scoreInterviewAnswerWithQuotes(ANSWER, 'system_design');
    const schema = extractSystemDesignSchema(ANSWER)!;
    const withoutQueue = { ...schema, nodes: schema.nodes.filter((node) => node.id !== 'queue') };
    expect(linkReviewToSchema(evaluation, withoutQueue).criteria.architecture).toMatchObject({
      schemaNodeIds: ['gateway', 'database'],
    });
    expect(linkReviewToSchema(evaluation, null)).toEqual(evaluation);
  });

  it('does not change the plain scoring', () => {
    expect(scoreInterviewAnswerWithQuotes(ANSWER, 'system_design').points).toBe(
      scoreInterviewAnswer(ANSWER, 'system_design').points,
    );
  });
});
