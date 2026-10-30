import { countryFitConstraint, readCountryFitScenario } from '../site/countryFitScenario';
import {
  CITY_DIRECTORY,
  DEFAULT_FIRST_RUN_DATA,
  POPULAR_CITIES,
  type FirstRunCity,
  type FirstRunData,
  type SourceType,
  type WorkFormat,
} from './firstRunTypes';
import type { WorkspaceInput } from '../workspace/workspaceStorage';
import type { IngestedResume } from '../journey/useResumeIngestion';

export { CITY_DIRECTORY, DEFAULT_FIRST_RUN_DATA, POPULAR_CITIES, type FirstRunCity };

export function initialFirstRunData(): FirstRunData {
  const scenario = readCountryFitScenario();
  const goal = readSessionGoal();
  const data = goal ? { ...DEFAULT_FIRST_RUN_DATA, goal } : DEFAULT_FIRST_RUN_DATA;
  if (!scenario) return data;
  return {
    ...data,
    context: {
      ...data.context,
      countryFitScenario: scenario,
    },
  };
}

/** Цель шага 1 живёт в sessionStorage до конца мастера: перезагрузка её не теряет (блок A, 30.10). */
const FIRST_RUN_GOAL_KEY = 'openqareer.firstRun.goal';

export function readSessionGoal(): string {
  try {
    return sessionStorage.getItem(FIRST_RUN_GOAL_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export function saveSessionGoal(goal: string): void {
  const value = goal.trim();
  try {
    if (value) sessionStorage.setItem(FIRST_RUN_GOAL_KEY, value);
    else sessionStorage.removeItem(FIRST_RUN_GOAL_KEY);
  } catch {
    // Без sessionStorage (приватное окно) цель живёт только до перезагрузки.
  }
}

export function clearSessionGoal(): void {
  try {
    sessionStorage.removeItem(FIRST_RUN_GOAL_KEY);
  } catch {
    // Нечего чистить.
  }
}

export function filterCities(
  query: string,
  cities: readonly FirstRunCity[] = CITY_DIRECTORY,
): FirstRunCity[] {
  const clean = query.trim().toLowerCase();
  if (!clean) return [...POPULAR_CITIES];
  return cities.filter(
    (c) =>
      c.name.toLowerCase().includes(clean) ||
      c.country.toLowerCase().includes(clean) ||
      (c.region && c.region.toLowerCase() === clean),
  );
}

export function selectCity(data: FirstRunData, city: FirstRunCity): FirstRunData {
  return {
    ...data,
    context: {
      ...data.context,
      city: city.name,
      country: city.country,
      region: city.region,
    },
  };
}

export function firstRunDataToWorkspaceInput(
  data: FirstRunData,
  result?: IngestedResume,
): WorkspaceInput {
  return {
    careerGoal: 'choose-role',
    resumeText: result?.text ?? '',
    resumeSource: result?.source ?? 'text',
    resumeFileName: result?.file?.name,
    resumePageCount: result?.file?.pages,
    targetDirection: result?.parsed.targetRole ?? '',
    regions: data.context.region ? [data.context.region] : [],
    currentSituation: data.goal,
    constraints: [
      data.context.format,
      data.context.city,
      data.context.country,
      data.context.countryFitScenario ? countryFitConstraint(data.context.countryFitScenario) : '',
      data.context.isRelocationReady ? 'Готов к релокации' : '',
    ]
      .filter(Boolean)
      .join(', '),
    urgency: 'active',
    resumeDraft: result?.draft,
    parsedResume: result?.parsed,
    resumeImported: result?.imported,
  };
}

export function skipSourceStep(data: FirstRunData): FirstRunData {
  return {
    ...data,
    isSourceSkipped: true,
    selectedSource: null,
  };
}

export function restoreSourceStep(
  data: FirstRunData,
  source: SourceType = 'linkedin',
): FirstRunData {
  return {
    ...data,
    isSourceSkipped: false,
    selectedSource: source,
  };
}

export function setGoal(data: FirstRunData, goal: string): FirstRunData {
  return { ...data, goal };
}

export function setWorkFormat(data: FirstRunData, format: WorkFormat): FirstRunData {
  return {
    ...data,
    context: { ...data.context, format },
  };
}

export function setRelocationReady(data: FirstRunData, isRelocationReady: boolean): FirstRunData {
  return {
    ...data,
    context: { ...data.context, isRelocationReady },
  };
}
