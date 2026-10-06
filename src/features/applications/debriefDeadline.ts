import { addBusinessDays } from '../../../shared/followUpPolicy';

export type DebriefDeadlinePreset = '3_days' | '5_days' | '10_days' | 'custom';

export interface ComputeDebriefFollowUpDateInput {
  readonly baseDate: string;
  readonly preset?: DebriefDeadlinePreset;
  readonly customDate?: string;
  readonly timezoneOffsetMinutes?: number;
}

const PRESET_BUSINESS_DAYS: Record<Exclude<DebriefDeadlinePreset, 'custom'>, number> = {
  '3_days': 3,
  '5_days': 5,
  '10_days': 10,
};

function normalizeBaseIso(baseDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(baseDate)) {
    return `${baseDate}T12:00:00.000Z`;
  }
  return baseDate;
}

function isoToLocalDateString(iso: string, timezoneOffsetMinutes: number): string {
  const localEpoch = new Date(iso).getTime() + timezoneOffsetMinutes * 60_000;
  return new Date(localEpoch).toISOString().slice(0, 10);
}

/**
 * Calculates deadline date (YYYY-MM-DD) adding business days and skipping weekends.
 */
export function calculateDebriefDeadline(
  baseDate: string,
  businessDays: number,
  timezoneOffsetMinutes = 0,
): string {
  const iso = normalizeBaseIso(baseDate);
  const targetIso = addBusinessDays(iso, businessDays, timezoneOffsetMinutes);
  return isoToLocalDateString(targetIso, timezoneOffsetMinutes);
}

/**
 * Computes debrief follow-up date based on preset or custom date.
 */
export function computeDebriefFollowUpDate(
  input: ComputeDebriefFollowUpDateInput,
): string | null {
  const { baseDate, preset = '3_days', customDate, timezoneOffsetMinutes = 0 } = input;
  if (preset === 'custom') {
    return customDate && customDate.trim().length > 0 ? customDate.trim() : null;
  }
  const days = PRESET_BUSINESS_DAYS[preset];
  return calculateDebriefDeadline(baseDate, days, timezoneOffsetMinutes);
}
