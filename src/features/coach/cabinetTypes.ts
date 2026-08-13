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

export interface VacancyAnalytics {
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
  source: 'hh';
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

export interface StoredVacancy {
  id: string;
  source: 'hh';
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
  version: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface VacancySubscriptionView {
  subscription: VacancySubscription;
  vacancies: StoredVacancy[];
}
