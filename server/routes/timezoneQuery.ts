import { z } from 'zod';

/**
 * `?tz=` (B251, S2, architecture.md §3, §7): minutes east of UTC. The
 * candidate's timezone is not stored anywhere yet, so the client sends its
 * own offset on every read. Clamped to the real range of UTC offsets
 * (UTC-12 to UTC+14) so a malformed value cannot shift business-day math by
 * an absurd amount.
 */
export const timezoneOffsetSchema = z.coerce.number().int().min(-720).max(840).optional();
