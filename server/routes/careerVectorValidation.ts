import { z } from 'zod';
import { VECTOR_QUESTIONS } from '../../src/features/strategy/careerVector';

const questionIds = new Set(VECTOR_QUESTIONS.map((q) => q.id));
const optionIds = new Map(
  VECTOR_QUESTIONS.map((q) => [q.id, new Set(q.options.map((o) => o.id))] as const),
);

/** Ответы опроса: только известные вопросы и варианты; вектор клиент не присылает. */
export const putCareerVectorSchema = z
  .object({
    choices: z.record(z.string().max(60), z.string().max(60)),
    antiGoals: z.array(z.string().max(300)).max(20).default([]),
    compromises: z.object({
      grade: z.enum(['none', 'one_step']),
      salary: z.enum(['none', 'up_to_10', 'up_to_20']),
    }),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const [questionId, optionId] of Object.entries(value.choices)) {
      if (!questionIds.has(questionId) || !optionIds.get(questionId)?.has(optionId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['choices', questionId],
          message: 'Неизвестный вопрос или вариант ответа',
        });
      }
    }
  });

export type PutCareerVectorInput = z.infer<typeof putCareerVectorSchema>;
