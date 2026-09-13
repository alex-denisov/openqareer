import type { SessionAuth } from '../auth/authService';
import type { ServerConfig } from '../config';
import type { CandidateStore } from '../data/candidateStore';
import type { UploadStaging } from '../data/uploadStaging';
import type { HhVacancySample } from '../connectors/hhVacancySearch';
import type { ProfileUrlImportResult } from '../connectors/profileUrlImport';
import type { CareerCommandDispatcher } from '../orchestration/careerCommandDispatcher';
import type { CoachProvider } from '../providers/coachProvider';
import type { ResumeStructurer } from '../providers/resumeStructurer';
import type { RoleNamer } from '../providers/roleNamer';
import type { RoleNamingFailureLog } from '../providers/roleNamingFailureLog';
import type { VacancySample } from '../domain/vacancy';
import type { MultiSourceVacancyEngine } from '../vacancies/multiSourceVacancyEngine';
import type { VacancyIntelligenceService } from '../vacancies/vacancyIntelligenceService';

export interface RouteDeps {
  /** Настройки веера обхода hh.ru: набор ролей выбирает владелец (B214). */
  hhCrawlSettings?: import('../vacancies/hhCrawlSettings').HhCrawlSettingsStore;
  config: ServerConfig;
  authService: SessionAuth;
  candidateStore: CandidateStore;
  /** Части файлов, ещё не собранные в документ (INC-031). */
  uploadStaging: UploadStaging;
  coachProvider: CoachProvider;
  careerCommandDispatcher: CareerCommandDispatcher | null;
  vacancyIntelligence: VacancyIntelligenceService;
  multiSourceEngine: MultiSourceVacancyEngine;
  searchVacancies: (input: { text: string; perPage?: number }) => Promise<HhVacancySample>;
  importProfile: (url: string) => Promise<ProfileUrlImportResult>;
  /** Absent when no provider credential is configured; the rules parser runs alone. */
  resumeStructurer?: ResumeStructurer;
  /** Роли называет модель по фактам кандидата (B180, срез 1в). */
  roleNamer?: RoleNamer;
  /** Окно последних отказов ступеней называния — для администратора (INC-035). */
  roleNamingFailures: RoleNamingFailureLog;
  searchRemotive?: (input: { text: string; perPage?: number }) => Promise<VacancySample>;
}
