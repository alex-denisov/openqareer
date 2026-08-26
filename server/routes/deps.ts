import type { SessionAuth } from '../auth/authService';
import type { ServerConfig } from '../config';
import type { CandidateStore } from '../data/candidateStore';
import type { HhVacancySample } from '../connectors/hhVacancySearch';
import type { ProfileUrlImportResult } from '../connectors/profileUrlImport';
import type { CareerCommandDispatcher } from '../orchestration/careerCommandDispatcher';
import type { CoachProvider } from '../providers/coachProvider';
import type { ResumeStructurer } from '../providers/resumeStructurer';
import type { VacancySample } from '../domain/vacancy';
import type { MultiSourceVacancyEngine } from '../vacancies/multiSourceVacancyEngine';
import type { VacancyIntelligenceService } from '../vacancies/vacancyIntelligenceService';

export interface RouteDeps {
  config: ServerConfig;
  authService: SessionAuth;
  candidateStore: CandidateStore;
  coachProvider: CoachProvider;
  careerCommandDispatcher: CareerCommandDispatcher | null;
  vacancyIntelligence: VacancyIntelligenceService;
  multiSourceEngine: MultiSourceVacancyEngine;
  searchVacancies: (input: { text: string; perPage?: number }) => Promise<HhVacancySample>;
  importProfile: (url: string) => Promise<ProfileUrlImportResult>;
  /** Absent when no provider credential is configured; the rules parser runs alone. */
  resumeStructurer?: ResumeStructurer;
  searchRemotive?: (input: { text: string; perPage?: number }) => Promise<VacancySample>;
}
