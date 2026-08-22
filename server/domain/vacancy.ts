import { z } from 'zod';

const VACANCY_SOURCES = ['hh', 'remotive'] as const;
export type VacancySource = (typeof VACANCY_SOURCES)[number] | string;

export interface VacancySample {
  source: VacancySource;
  query: string;
  found: number;
  fetchedAt: string;
  items: Array<{
    id: string;
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
  }>;
}

export interface VacancySourceHealth {
  source: string;
  status:
    | 'healthy'
    | 'degraded'
    | 'unavailable'
    | 'official_access_required';
  lastAttemptAt: string;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  retryAfterAt: string | null;
  consecutiveFailures: number;
}

export const vacancySubscriptionInputSchema = z.object({
  source: z.enum(VACANCY_SOURCES),
  query: z.string().trim().min(2).max(200),
  cadenceMinutes: z.number().int().min(60).max(10_080).default(360),
});

export type VacancySubscriptionInput = z.infer<
  typeof vacancySubscriptionInputSchema
>;

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

export interface StoredVacancySubscription {
  id: string;
  source: VacancySource;
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

export interface ClaimedVacancySubscription extends StoredVacancySubscription {
  candidateId: string;
}

export interface StoredVacancy {
  id: string;
  source: VacancySource;
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
  workMode: VacancySample['items'][number]['workMode'];
  requirements: string[];
  version: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface VacancyRefreshResult {
  subscriptionId: string;
  created: number;
  updated: number;
  unchanged: number;
  fetchedAt: string;
  nextRunAt: string;
}
