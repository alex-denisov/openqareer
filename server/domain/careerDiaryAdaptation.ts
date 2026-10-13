import { z } from 'zod';

const calendarDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
});

const isoDateTimeSchema = z.string().datetime();

export const careerDiaryQuarterDecisionSchema = z.object({
  quarterId: z.string().regex(/^Q[1-4] \d{4}$/u),
  decision: z.enum(['keep', 'move']),
  decidedAt: calendarDateSchema,
}).strict();

const adaptationTaskSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000),
  stage: z.enum(['prep', 'days_1_30', 'days_31_60', 'days_61_90']),
  category: z.enum(['people', 'strategy', 'delivery', 'alignment']),
  dueDate: calendarDateSchema,
  completed: z.boolean(),
  source: z.enum(['template', 'candidate']),
}).strict();

export const careerDiaryAdaptationPlanSchema = z.object({
  id: z.string().trim().min(1).max(80),
  workplaceId: z.string().trim().min(1).max(80),
  startDate: calendarDateSchema,
  createdAt: isoDateTimeSchema,
  status: z.enum(['active', 'closed']),
  closedAt: isoDateTimeSchema.nullable(),
  tasks: z.array(adaptationTaskSchema).max(100),
}).strict().superRefine((plan, context) => {
  if ((plan.status === 'closed') !== (plan.closedAt !== null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Дата закрытия должна соответствовать статусу плана.',
      path: ['closedAt'],
    });
  }
});

export const careerDiaryPlanningSchema = z.object({
  adaptationPlan: careerDiaryAdaptationPlanSchema.nullable(),
}).strict();

export type CareerDiaryQuarterDecision = z.infer<typeof careerDiaryQuarterDecisionSchema>;
export type CareerDiaryAdaptationPlanInput = z.infer<typeof careerDiaryAdaptationPlanSchema>;
export type CareerDiaryPlanningInput = z.infer<typeof careerDiaryPlanningSchema>;
