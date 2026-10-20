/** Experience fields a consultant revision may change directly (B340 dates, B540 team size). */
export const EXPERIENCE_REVISION_FIELDS = ['startDate', 'endDate', 'teamSize'] as const;

export type ExperienceRevisionField = (typeof EXPERIENCE_REVISION_FIELDS)[number];

/** A proposed team size travels as digits, «38»; unknown is the empty text. */
export const TEAM_SIZE_TEXT_PATTERN = /^[1-9]\d{0,4}$/u;
