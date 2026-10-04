export const APPLICATION_ARCHIVE_REASONS = [
  'candidate',
  'vacancy_closed',
  'stale',
  'unknown',
] as const;

export type ApplicationArchiveReason = (typeof APPLICATION_ARCHIVE_REASONS)[number];

export const DEFAULT_APPLICATION_ARCHIVE_STALE_DAYS = 30;
