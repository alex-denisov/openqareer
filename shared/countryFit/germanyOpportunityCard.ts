export type GermanOpportunityCardLanguage = 'none' | 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2' | 'native';
export type GermanQualificationRecognition = 'fully' | 'partially' | 'not-recognized' | 'unknown';

export interface GermanOpportunityCardProfile {
  readonly qualificationRecognition: GermanQualificationRecognition;
  readonly shortageOccupation: boolean | null;
  readonly experienceYearsLastFive: number | null;
  readonly experienceYearsLastSeven: number | null;
  readonly germanLevel: GermanOpportunityCardLanguage | null;
  readonly englishLevel: GermanOpportunityCardLanguage | null;
  readonly age: number | null;
  readonly germanyStayMonthsLastFive: number | null;
  readonly partnerQualifiedAndApplying: boolean | null;
}

export interface GermanOpportunityCardScore {
  readonly points: number;
  readonly complete: boolean;
  readonly missingCriteria: readonly string[];
}

const germanPoints: Readonly<Record<GermanOpportunityCardLanguage, number>> = {
  none: 0,
  A1: 0,
  A2: 1,
  B1: 2,
  B2: 3,
  C1: 3,
  C2: 3,
  native: 3,
};

const englishBonus = (level: GermanOpportunityCardLanguage): number =>
  level === 'C1' || level === 'C2' || level === 'native' ? 1 : 0;

export function calculateGermanOpportunityCardPoints(
  profile: GermanOpportunityCardProfile,
): GermanOpportunityCardScore {
  let points = 0;
  const missing: string[] = [];

  if (profile.qualificationRecognition === 'partially') points += 4;
  if (profile.qualificationRecognition === 'unknown') missing.push('признание квалификации');
  if (profile.shortageOccupation === null) missing.push('профессия из списка дефицитных');
  else if (profile.shortageOccupation) points += 1;

  const experience = experiencePoints(profile);
  points += experience.points;
  if (experience.unknown) missing.push('релевантный стаж за последние пять и семь лет');

  if (profile.germanLevel === null) missing.push('уровень немецкого');
  else points += germanPoints[profile.germanLevel];
  if (profile.englishLevel === null) missing.push('уровень английского');
  else points += englishBonus(profile.englishLevel);

  if (profile.age === null) missing.push('возраст');
  else if (profile.age <= 35) points += 2;
  else if (profile.age <= 40) points += 1;

  if (profile.germanyStayMonthsLastFive === null) missing.push('предыдущее проживание в Германии');
  else if (profile.germanyStayMonthsLastFive >= 6) points += 1;

  if (profile.partnerQualifiedAndApplying === null) missing.push('квалификация партнёра, если он подаётся вместе');
  else if (profile.partnerQualifiedAndApplying) points += 1;

  return { points, complete: missing.length === 0, missingCriteria: missing };
}

function experiencePoints(profile: GermanOpportunityCardProfile): { points: number; unknown: boolean } {
  const lastFive = profile.experienceYearsLastFive;
  const lastSeven = profile.experienceYearsLastSeven;
  if (lastSeven !== null && lastSeven >= 5) return { points: 3, unknown: false };
  if (lastFive !== null && lastFive >= 2) return { points: 2, unknown: lastSeven === null };
  if (lastFive === null || lastSeven === null) return { points: 0, unknown: true };
  return { points: 0, unknown: false };
}

export function germanOpportunityCardLanguageGate(profile: GermanOpportunityCardProfile): boolean | null {
  const germanPasses = profile.germanLevel !== null && profile.germanLevel !== 'none';
  const englishPasses = ['B2', 'C1', 'C2', 'native'].includes(profile.englishLevel ?? '');
  if (germanPasses || englishPasses) return true;
  if (profile.germanLevel === null || profile.englishLevel === null) return null;
  return false;
}
