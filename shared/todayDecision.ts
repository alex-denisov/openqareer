import { z } from 'zod';

export const todayDecisionSelectionSchema = z
  .object({
    applicationId: z.string().min(1).max(200),
    resolution: z.enum(['accepted', 'dismissed']),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type TodayDecisionSelection = z.infer<typeof todayDecisionSelectionSchema>;

export function currentTodayDecision(
  selection: TodayDecisionSelection | undefined,
  now = new Date(),
  timeZone = 'UTC',
): TodayDecisionSelection | undefined {
  if (!selection) return undefined;
  const calendar = new Intl.DateTimeFormat('en-CA', { timeZone });
  return calendar.format(new Date(selection.updatedAt)) === calendar.format(now)
    ? selection
    : undefined;
}
