export interface AccountSnapshot {
  username: string;
  email: string | null;
  displayName: string | null;
  profile: {
    headline: string | null;
    location: string | null;
    workMode: 'office' | 'hybrid' | 'remote' | 'flexible' | null;
    updatedAt: string | null;
  };
  sessions: Array<{
    id: string;
    current: boolean;
    createdAt: string;
    lastSeenAt: string;
    expiresAt: string;
  }>;
}

export type CandidateDocumentKind =
  | 'resume'
  | 'cover_letter'
  | 'certificate'
  | 'portfolio'
  | 'profile_export'
  | 'other';

export interface CandidateDocument {
  id: string;
  familyId: string;
  version: number;
  kind: CandidateDocumentKind;
  source: 'upload' | 'generated' | 'import';
  fileName: string;
  mimeType: string;
  byteSize: number;
  sha256: string;
  parseStatus: 'pending' | 'ready' | 'failed' | 'not_applicable';
  retentionUntil: string | null;
  supersedesDocumentId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface VacancyAnalytics {
  sampleSize: number;
  sourceFound: number | null;
  salaryKnown: number;
  unknownSalary: number;
  observedFrom: string | null;
  observedTo: string | null;
  currencies: Array<{
    currency: string;
    vacancies: number;
    medianFrom: number | null;
    medianTo: number | null;
  }>;
  topLocations: Array<{ location: string; vacancies: number }>;
}

export interface VacancySubscription {
  id: string;
  source: VacancySourceId;
  query: string;
  cadenceMinutes: number;
  status: 'active' | 'paused';
  nextRunAt: string;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
  analytics: VacancyAnalytics;
}

interface StoredVacancy {
  id: string;
  source: VacancySourceId;
  externalId: string;
  title: string;
  company: string;
  location: string;
  sourceUrl: string;
  publishedAt: string | null;
  salary: {
    from: number | null;
    to: number | null;
    currency: string;
    gross: boolean;
  } | null;
  workMode: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  requirements: string[];
  version: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export type VacancySourceId = 'hh' | 'remotive';

export interface VacancySourceRegistryEntry {
  id: VacancySourceId;
  name: string;
  market: string;
  transport: 'official_api' | 'public_api';
  searchCoverage: string;
  attributionUrl: string;
  documentationUrl: string;
  reviewedAt: string;
  health: {
    status:
      | 'not_checked'
      | 'healthy'
      | 'degraded'
      | 'unavailable'
      | 'official_access_required';
    lastAttemptAt: string | null;
    lastSuccessAt: string | null;
    lastErrorCode: string | null;
    retryAfterAt: string | null;
    consecutiveFailures: number;
  };
}

export interface VacancySubscriptionView {
  subscription: VacancySubscription;
  vacancies: StoredVacancy[];
}

interface VacancyCluster {
  id: string;
  canonicalTitle: string;
  canonicalCompany: string;
  canonicalLocation?: string;
  isRemote: boolean;
  salary?: {
    from?: number;
    to?: number;
    currency?: string;
    gross?: boolean;
  };
  descriptionSummary: string;
  skills: string[];
  primaryUrl: string;
  sources: Array<{
    sourceType: string;
    sourceId: string;
    sourceUrl: string;
    channelName?: string;
    observedAt: string;
  }>;
  firstObservedAt: string;
  lastSeenAt: string;
  status: 'active' | 'archived';
  vacanciesCount: number;
}

interface VacancyMatchExplanation {
  clusterId: string;
  matchScore: number;
  fitLevel: 'strong' | 'good' | 'potential' | 'low';
  matchingPoints: string[];
  missingPoints: string[];
  /**
   * Настоящее число совпавших и недостающих требований. Списки приходят
   * обрезанными до видимых трёх (INC-029), поэтому покрытие считается отсюда.
   */
  matchingCount?: number;
  missingCount?: number;
  summary: string;
  calculatedAt: string;
}

export interface MatchedVacancyItem {
  cluster: VacancyCluster;
  explanation: VacancyMatchExplanation;
}

