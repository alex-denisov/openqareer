export type VacancySourceType =
  | 'hh'
  | 'remotive'
  | 'telegram'
  | 'rss'
  | 'career_site'
  | 'direct';

export interface VacancySalary {
  from?: number;
  to?: number;
  currency?: string;
  gross?: boolean;
}

export interface VacancyProvenance {
  sourceType: VacancySourceType;
  sourceId: string;
  sourceUrl: string;
  externalId?: string;
  channelName?: string;
  observedAt: string;
}

export interface UnifiedVacancy {
  id: string;
  fingerprint: string;
  title: string;
  company: string;
  location?: string;
  isRemote?: boolean;
  salary?: VacancySalary;
  description: string;
  requiredSkills: string[];
  employmentType?: string;
  experienceLevel?: string;
  responsibilities?: string[];
  qualifications?: string[];
  niceToHave?: string[];
  benefits?: string[];
  aboutCompany?: string;
  contactInfo?: string;
  fullDescription?: string;
  postType?: 'vacancy' | 'candidate_resume' | 'ad' | 'digest';
  url: string;
  provenance: VacancyProvenance;
  publishedAt: string;
  status: 'active' | 'archived';
  archivedAt?: string;
}

export interface VacancyCluster {
  id: string;
  canonicalTitle: string;
  canonicalCompany: string;
  canonicalLocation?: string;
  isRemote: boolean;
  salary?: VacancySalary;
  descriptionSummary: string;
  skills: string[];
  primaryUrl: string;
  sources: VacancyProvenance[];
  firstObservedAt: string;
  lastSeenAt: string;
  status: 'active' | 'archived';
  vacanciesCount: number;
}

export interface VacancyMatchExplanation {
  clusterId: string;
  matchScore: number; // 0..100
  fitLevel: 'strong' | 'good' | 'potential' | 'low';
  matchingPoints: string[];
  missingPoints: string[];
  summary: string;
  calculatedAt: string;
}

export interface VacancySourceConfig {
  id: string;
  name: string;
  type: VacancySourceType;
  enabled: boolean;
  targetUrl: string;
  refreshIntervalMinutes: number;
  lastSyncAt?: string;
  lastStatus?: 'healthy' | 'degraded' | 'error';
  lastErrorMessage?: string;
  itemsFoundTotal: number;
  itemsActiveTotal: number;
}
