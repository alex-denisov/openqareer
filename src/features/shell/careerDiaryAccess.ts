import { createContext, useContext } from 'react';
import type { CareerDiaryWorkplace, CareerDiaryWorkplaceInput } from '../../../shared/careerDiary';

export type CareerDiaryAccessLoadState = 'disabled' | 'loading' | 'ready' | 'error';

export interface CareerDiaryProfileExperience {
  readonly id: string;
  readonly title?: string;
  readonly employer?: string;
  readonly current: boolean;
  readonly endDate?: string;
  readonly startDate?: string;
}

export interface CareerDiaryAccessContextValue {
  readonly state: CareerDiaryAccessLoadState;
  readonly primaryWorkplace: CareerDiaryWorkplace | null;
  readonly workplaces: readonly CareerDiaryWorkplace[];
  readonly profileExperience: CareerDiaryProfileExperience | null;
  readonly profileExperiences: readonly CareerDiaryProfileExperience[];
  readonly profileRoleChange: string | null;
  readonly isVisible: boolean;
  readonly error: string | null;
  readonly saving: boolean;
  readonly mutationError: string | null;
  readonly reload: () => void;
  readonly dismissRoleChange: () => void;
  readonly updateCurrentDiaryRole: () => Promise<boolean>;
  readonly createDiaryFromProfile: (input: CareerDiaryWorkplaceInput) => Promise<boolean>;
  readonly startNewDiary: (startDate: string) => Promise<boolean>;
  readonly setPrimaryWorkplace: (workplaceId: string) => Promise<boolean>;
}

const EMPTY_CAREER_DIARY_ACCESS: CareerDiaryAccessContextValue = {
  state: 'disabled',
  primaryWorkplace: null,
  workplaces: [],
  profileExperience: null,
  profileExperiences: [],
  profileRoleChange: null,
  isVisible: false,
  error: null,
  saving: false,
  mutationError: null,
  reload: () => undefined,
  dismissRoleChange: () => undefined,
  updateCurrentDiaryRole: async () => false,
  createDiaryFromProfile: async () => false,
  startNewDiary: async () => false,
  setPrimaryWorkplace: async () => false,
};

const CareerDiaryAccessContext = createContext(EMPTY_CAREER_DIARY_ACCESS);

export const CareerDiaryAccessProvider = CareerDiaryAccessContext.Provider;

export function useCareerDiaryAccess(): CareerDiaryAccessContextValue {
  return useContext(CareerDiaryAccessContext);
}

export function shouldShowCareerDiary(
  workplace: CareerDiaryWorkplace | null,
  profileExperience: CareerDiaryProfileExperience | null,
  asOf: string,
): boolean {
  if (!workplace) return false;
  const profileMatches = profileExperience?.id === workplace.sourceExperienceId;
  if (profileMatches && profileExperience.current && !profileExperience.endDate) return true;
  if (workplace.status !== 'active') return false;
  if (workplace.startDate > asOf) return true;
  return false;
}

export function hasCurrentProfileExperience(
  experiences: readonly CareerDiaryProfileExperience[],
): boolean {
  return experiences.some((experience) => experience.current && !experience.endDate);
}

export function careerDiaryProfileRoleChange(
  workplace: CareerDiaryWorkplace,
  profileExperience: CareerDiaryProfileExperience | null,
): string | null {
  const profileRole = profileExperience?.title?.trim();
  if (!profileRole || normalizeRole(profileRole) === normalizeRole(workplace.title)) return null;
  return profileRole;
}

function normalizeRole(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').toLocaleLowerCase('ru-RU');
}
