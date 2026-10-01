export type SeniorityLevel = 'ic' | 'lead' | 'head' | 'vp' | 'c-level';

export const LEVEL_HUMAN_NAMES: Readonly<Record<SeniorityLevel, string>> = {
  ic: 'Специалист',
  lead: 'Лид',
  head: 'Руководитель',
  vp: 'VP',
  'c-level': 'C-level',
};

const RUSSIAN_TO_SENIORITY: Readonly<Record<string, SeniorityLevel>> = {
  специалист: 'ic',
  лид: 'lead',
  руководитель: 'head',
  vp: 'vp',
  'c-level': 'c-level',
};

export function parseSeniorityLevel(value: string): SeniorityLevel | undefined {
  const norm = value.trim().toLowerCase();
  if (norm === 'ic' || norm === 'lead' || norm === 'head' || norm === 'vp' || norm === 'c-level') {
    return norm;
  }
  return RUSSIAN_TO_SENIORITY[norm];
}

export function isSeniorityLevel(value: string): boolean {
  return parseSeniorityLevel(value) !== undefined;
}

export function formatSeniorityLevel(value: string): string {
  const level = parseSeniorityLevel(value);
  return level ? LEVEL_HUMAN_NAMES[level] : value;
}

export function extractSeniorityLevelFromPoint(point: string): SeniorityLevel | undefined {
  const stripped = point.replace(/^Подтверждённый навык:\s*/iu, '').trim();
  return parseSeniorityLevel(stripped);
}

export function extractVacancyRequirements(
  matchingPoints: readonly string[] = [],
  missingPoints: readonly string[] = [],
  clusterSkills: readonly string[] = [],
): {
  readonly skillMatching: readonly string[];
  readonly skillMissing: readonly string[];
  readonly vacancyLevel?: SeniorityLevel;
} {
  const vacancyLevel = [...missingPoints, ...matchingPoints, ...clusterSkills]
    .map(extractSeniorityLevelFromPoint)
    .find((lvl): lvl is SeniorityLevel => lvl !== undefined);
  const skillMatching = matchingPoints.filter((point) => !extractSeniorityLevelFromPoint(point));
  const skillMissing = missingPoints.filter((point) => !extractSeniorityLevelFromPoint(point));
  return { skillMatching, skillMissing, vacancyLevel };
}

