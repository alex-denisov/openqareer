import { z } from 'zod';

export const todayDecisionSelectionSchema = z
  .object({
    applicationId: z.string().min(1).max(200),
    resolution: z.enum(['accepted', 'dismissed']),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const todayActionIdSchema = z.string().regex(/^[a-f0-9]{16}$/u);

/** Без поля — «отложено на сегодня»; accepted/dismissed — решение дня закрыто. */
export const todayActionResolutionSchema = z.enum(['accepted', 'dismissed']);

export const todayActionDeferralSchema = z
  .object({
    actionId: todayActionIdSchema,
    deferredThroughDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .refine((date) => {
        const parsed = new Date(`${date}T00:00:00.000Z`);
        return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
      }),
    resolution: todayActionResolutionSchema.optional(),
  })
  .strict();

export type TodayActionDeferral = z.infer<typeof todayActionDeferralSchema>;

export const todayActionDeferralInputSchema = z
  .object({
    actionId: todayActionIdSchema,
    tz: z.string().trim().min(1).max(100).refine(isIanaTimeZone),
    resolution: todayActionResolutionSchema.optional(),
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

export function candidateCalendarDate(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
}

export function isTodayActionDeferred(
  deferral: TodayActionDeferral | undefined,
  now = new Date(),
  timeZone = 'UTC',
): boolean {
  return (
    deferral !== undefined && deferral.deferredThroughDate >= candidateCalendarDate(now, timeZone)
  );
}

function isIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}
