import { z } from 'zod';

const ISO_DATE_MAX_LENGTH = 40;

/**
 * A tracker date from the client: an ISO calendar date (`2026-02-01`) or an
 * ISO date-time with an explicit offset. Anything else used to reach the
 * store as an opaque string and silently turned follow-up math into NaN
 * (security review of B251, 2026-09-24).
 */
export const isoDateField = z
  .string()
  .max(ISO_DATE_MAX_LENGTH)
  .trim()
  .refine(
    (value) =>
      z.string().date().safeParse(value).success ||
      z.string().datetime({ offset: true }).safeParse(value).success,
    { message: 'Ожидается дата ISO 8601' },
  );
