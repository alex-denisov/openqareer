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
import type { CoverLetterWriter } from '../providers/coverLetterWriter';
import type { VacancySample } from '../domain/vacancy';
import type { MultiSourceVacancyEngine } from '../vacancies/multiSourceVacancyEngine';
import type { VacancyIntelligenceService } from '../vacancies/vacancyIntelligenceService';

export interface RuntimeMemoryReport {
  readonly ingestPaused: boolean;
  readonly heapUsedMb: number;
  readonly heapLimitMb: number;
  readonly poolSize: number;
  /** Сведение: кластеры, сборки, длительность последней, идёт ли сейчас (B221). */
  readonly recluster?: {
    clusters: number;
    /** Записей в очереди на сведение — ноль в режиме `off` (B230). */
    pending: number;
    /** Уловов, сведённых по ключам (B230). */
    keyedClusterings: number;
    rebuilds: number;
    lastReclusterMs: number;
    inFlight: boolean;
  };
}

export interface RouteDeps {
  /** Настройки веера обхода hh.ru: набор ролей выбирает владелец (B214). */
  hhCrawlSettings?: import('../vacancies/hhCrawlSettings').HhCrawlSettingsStore;
  /** Память и пауза опросов — только администратору (B220). */
  runtimeMemory?: () => RuntimeMemoryReport;
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
  /** Сопроводительное письмо пишет модель, шаблон — запас (B266, пункт 7). */
  coverLetterWriter?: CoverLetterWriter;
  /** Окно последних отказов ступеней называния — для администратора (INC-035). */
  roleNamingFailures: RoleNamingFailureLog;
  searchRemotive?: (input: { text: string; perPage?: number }) => Promise<VacancySample>;
  /** Репозиторий контактов рекрутеров и нанимателей (B223). */
  recruiterContactsRepo?: import('../data/sqliteRecruiterContactsRepository').SqliteRecruiterContactsRepository;
  /** Репозиторий аудита репутации и цифрового следа кандидата (B224). */
  candidateReputationRepo?: import('../data/sqliteCandidateReputationRepository').SqliteCandidateReputationRepository;
  /** Реестр управляемых LinkedIn-сессий; доступен только роли admin (B239). */
  linkedinPool?: import('../linkedinPool/sqliteLinkedinPoolRepository').SqliteLinkedinPoolRepository;
}
