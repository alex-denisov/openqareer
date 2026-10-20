import { z } from 'zod';

export const adaptationStageSchema = z.enum(['prep', 'days_1_30', 'days_31_60', 'days_61_90']);
export const adaptationTaskSuggestionSchema = z.object({
  targetTaskId: z.string().trim().min(1).max(80).nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1500),
  dueDate: z.string().date().nullable(),
});
export const adaptationContextSchema = z.object({
  workplaceId: z.string().min(1).max(200),
  planId: z.string().min(1).max(200),
  stage: adaptationStageSchema,
  version: z.string().regex(/^[a-f0-9]{64}$/),
  label: z.string().min(1).max(600),
  readOnly: z.boolean(),
});
export type AdaptationContext = z.infer<typeof adaptationContextSchema>;
export type AdaptationTaskSuggestion = z.infer<typeof adaptationTaskSuggestionSchema>;

export const ADAPTATION_STAGE_LABELS: Record<z.infer<typeof adaptationStageSchema>, string> = {
  prep: 'Подготовка', days_1_30: 'Дни 1–30', days_31_60: 'Дни 31–60', days_61_90: 'Дни 61–90',
};
